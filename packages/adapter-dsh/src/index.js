// DSH 适配器：尽量薄，只把宿主事件接到核心（架构方案第十二节，接口依据 docs/decisions/001-dsh-接口.md）。
// 只用命名导出：有 export default 时 DSH 加载器会丢掉 inject 与 Config。
import { createCore } from 'chara-core';

export const name = 'chara-soul';
export const inject = [];

/**
 * user/message 不全是用户说的话：运行时上下文、技能目录、时间、别的插件、分身完成通知都以它出现。
 * 实测来源有 user / runtime-context / skill-catalog / time-context / dsh-mnemon / agent-message / subagent-settled，
 * 所以只认 source.kind === 'user'，而不是逐个排除。
 */
export const isUserSpeech = (message) => message?.source?.kind === 'user';

/**
 * 用户在界面里打的字带 rpcId（客户端请求号）；分身与 mnemon 后台任务收到的提示只有 { kind: 'user' }。
 * shortcut: 用 rpcId 判断主会话，接入 QQ 等非界面来源（第三期）时改用宿主正式的父子字段。
 */
export const isFromClient = (message) => isUserSpeech(message) && typeof message.source.rpcId === 'string';

/** 从消息里取出纯文本。 */
export function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
}

const SERVICES = ['systemPrompt', 'tools', 'commands', 'llm', 'subagents', 'agents'];

/** 把段名按插件前缀归类，用来列出别的插件注入了什么（002 号决定）。 */
export function groupSections(names) {
  const groups = new Map();
  for (const n of names) {
    if (n.startsWith('chara:')) continue;
    const key = n.split(':')[0];
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups].map(([k, n]) => (n > 1 ? `${k}（${n} 段）` : k)).join('、');
}

export function apply(ctx, _config, deps = {}) {
  const log = ctx.logger?.('chara-soul') ?? console;
  const core = deps.core ?? createCore({ host: 'dsh' });
  ctx.on?.('dispose', () => core.close());

  const mainSessions = new Set();
  let lastAssembly;

  // 本性走系统提示段，此刻走运行时上下文。没有个体时两段都不注册，什么都不注入（验收 1）
  let sync = () => {};
  ctx.inject(['systemPrompt'], (c) => {
    const sp = c.systemPrompt;
    let off = null;
    sync = () => {
      const want = core.nature() !== '';
      if (want && !off) {
        const a = sp.section({ name: 'chara:nature', order: (sp.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') ?? 0) + 1, interpolate: false, text: () => core.nature() });
        const b = sp.context({ name: 'chara:moment', order: (sp.getContextOrder('WORKING_DIRECTORY') ?? 940) + 1, interpolate: false, text: () => core.moment() });
        off = () => (a(), b());
      } else if (!want && off) {
        off();
        off = null;
      }
    };
    sync();
  });

  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const out = await next();
    lastAssembly = { sections: (out?.sections ?? []).map((s) => s?.name ?? '?'), contexts: (out?.contexts ?? []).map((s) => s?.name ?? '?') };
    return out;
  });

  // 原话：只记主会话里用户亲口说的话和模型说出来的话
  ctx.on('session/event', (session, event) => {
    try {
      if (event?.type !== 'user/message' && event?.type !== 'assistant/message') return;
      const sid = String(session?.id ?? '?');
      const d = event.data ?? {};
      // 实测：user/message 的 data 就是消息本身；assistant/message 的 data 是 { turn, step, message }
      const message = d.message ?? d;
      if (event.type === 'user/message') {
        if (!isUserSpeech(message)) return;
        // 实测 header：分身会话带 parentSession、origin: 'subagent'、delegationDepth ≥ 1
        if (isFromClient(message) && !session?.header?.parentSession) mainSessions.add(sid);
        if (!mainSessions.has(sid)) return;
        core.afterTurn({ session: sid, role: 'user', text: messageText(message), tz: message.source.clientTimeZone });
      } else if (mainSessions.has(sid)) {
        core.afterTurn({ session: sid, role: 'assistant', text: messageText(message) });
      }
    } catch (e) {
      log.warn('记录原话失败：%s', e?.message ?? e);
    }
  });

  const status = (inv) =>
    [
      `服务：${SERVICES.map((s) => `${ctx.get?.(s) ? '✓' : '✗'} ${s}`).join('  ')}`,
      `数据目录：${core.home}`,
      `当前会话 ${inv?.agent?.session?.id ?? '?'}，已认作主会话的：${[...mainSessions].join('、') || '无'}`,
    ].join('\n');

  ctx.inject(['commands'], (c) => {
    c.effect(() =>
      c.commands.register({
        name: 'chara',
        description: '角色灵魂引擎：new <名字> | list | use <名字> | show | profile | status',
        input: { hint: 'new <名字> | list | use <名字> | show | profile | status' },
        handler: async (inv) => {
          const raw = String(inv.rawInput ?? '').trim();
          if (raw === 'status') return { kind: 'success', text: status(inv) };
          const r = core.command(raw);
          sync();
          let text = r.text;
          if (raw === 'show' && lastAssembly) text += `\n\n【其他插件注入的段】\n系统提示：${groupSections(lastAssembly.sections) || '无'}\n运行时上下文：${groupSections(lastAssembly.contexts) || '无'}`;
          return { kind: r.ok ? 'success' : 'error', text };
        },
      }),
    );
  });
}
