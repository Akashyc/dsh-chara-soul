// DSH 适配器：尽量薄，只把宿主事件接到核心（架构方案第十二节，接口依据 docs/decisions/001-dsh-接口.md）。
// 只用命名导出：有 export default 时 DSH 加载器会丢掉 inject 与 Config。
// 相对路径而不是包名：发布的安装包里核心与适配器同在一个包内，没有 chara-core 这个依赖
import { createCore } from '../../core/src/index.js';
import { createUiHandler } from '../../ui/src/handler.js';
import { randomBytes } from 'node:crypto';

// 宿主路由提供 @deepseek-ai/dsh-tools；本地测试时没有，退化为原样返回。
const { defineTool } = await import('@deepseek-ai/dsh-tools').catch(() => ({ defineTool: (d) => d }));

export const name = 'chara-soul';
export const inject = [];

/**
 * user/message 不全是用户说的话：运行时上下文、技能目录、时间、别的插件、分身完成通知都以它出现。
 * 实测来源有 user / runtime-context / skill-catalog / time-context / dsh-mnemon / agent-message / subagent-settled，
 * 所以只认 source.kind === 'user'，而不是逐个排除。
 */
export const isUserSpeech = (message) => message?.source?.kind === 'user';

/**
 * 主会话里用户说的话。实测会话头：分身带 parentSession 与 origin: 'subagent'，主会话两者都没有。
 * 不看 rpcId：DSH 界面打的字带它，QQ 插件转进来的消息只有 { kind: 'user' }。
 */
export const isMainSpeech = (message, session) =>
  isUserSpeech(message) && !session?.header?.parentSession && session?.header?.origin !== 'subagent';

/** 从消息里取出纯文本。 */
export function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
}

const SERVICES = ['systemPrompt', 'tools', 'commands', 'llm', 'subagents', 'agents', 'agentPresets'];

/** 本项目自带的预设 id：闲谈陪伴、全能女仆，定义在 cordis.patch.yml（005 号决定）。 */
export const OWN_PRESETS = ['chara-soul', 'chara-soul-maid'];

// 官方预设不发布显示名（界面上的名字来自宿主客户端的字典），这里补上中文名
const BUILT_IN = { standard: '标准', ptc: 'PTC', minimal: '极简', cordis: '创造' };

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

  /** 某个会话正在用的预设 id；宿主没有预设服务时退回会话头里记的，都拿不到时为 undefined。 */
  const presetOf = (agent) => ctx.get?.('agentPresets')?.composedPreset?.(agent?.ctx) ?? agent?.session?.header?.agentPreset;

  /**
   * 已注册、能用的预设，给设置页「分身用的预设」下拉框；拿不到列表时返回 null，设置页不显示这一栏。
   * 不列自带的两个：闲谈陪伴几乎没有干活的工具，全能女仆的规则让它派活，而分身不能再派分身。
   */
  const listPresets = async () => {
    const list = await ctx.get?.('agentPresets')?.list?.();
    return Array.isArray(list) ? list.filter((p) => !p.broken && !OWN_PRESETS.includes(p.id)).map((p) => ({ id: p.id, name: p.name ?? BUILT_IN[p.id] ?? p.id })) : null;
  };

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

  // 分身：chara_envoy 派出时登记，分身会话里取最后一句话作汇报，结算通知到达时落库。子会话 id → { session, task, report }
  const envoys = new Map();

  // 原话：只记主会话里用户亲口说的话和模型说出来的话
  ctx.on('session/event', (session, event) => {
    try {
      if (event?.type !== 'user/message' && event?.type !== 'assistant/message') return;
      const sid = String(session?.id ?? '?');
      const d = event.data ?? {};
      // 实测：user/message 的 data 就是消息本身；assistant/message 的 data 是 { turn, step, message }
      const message = d.message ?? d;
      const parent = session?.header?.parentSession;
      if (parent) {
        // 分身会话一律不记原话；我们派出的分身取最后一句非空回复作汇报
        // （分身先用 send_message 回报时，结算通知里会省略最后一句，所以不从通知里取）
        if (event.type === 'assistant/message' && envoys.has(sid)) {
          const t = messageText(message).trim();
          if (t) envoys.get(sid).report = t;
        }
        return;
      }
      if (event.type === 'user/message' && message?.source?.kind === 'subagent-settled') {
        const e = envoys.get(message.source.senderSessionId);
        if (e) {
          core.envoyReport({ id: message.source.senderSessionId, ...e });
          envoys.delete(message.source.senderSessionId);
        }
        return;
      }
      if (event.type === 'user/message') {
        if (!isUserSpeech(message)) return;
        // 实测 header：分身会话带 parentSession、origin: 'subagent'、delegationDepth ≥ 1
        if (isMainSpeech(message, session)) mainSessions.add(sid);
        if (!mainSessions.has(sid)) return;
        core.afterTurn({ session: sid, role: 'user', text: messageText(message), tz: message.source.clientTimeZone });
      } else if (mainSessions.has(sid)) {
        core.afterTurn({ session: sid, role: 'assistant', text: messageText(message) });
      }
    } catch (e) {
      log.warn('记录原话失败：%s', e?.message ?? e);
    }
  });

  // 派分身（验收 6）。工具始终注册（架构方案 12.2）；不能派时让本体自己做（验收 7）
  ctx.inject(['tools'], (c) => {
    c.effect(() =>
      c.tools.register(
        defineTool({
          name: 'chara_envoy',
          description: '派一个分身去办手边没有工具办的事（写文件、跑命令等），或大批量、耗时长的活。立即返回；分身办完后你会收到它的汇报，核对后再用自己的话转告用户。',
          parameters: {
            task: { type: 'string', required: true, description: '要办的事，写清对象、范围与具体要求' },
            acceptance: { type: 'string', description: '怎样算办完' },
            context: { type: 'string', description: '分身需要知道的用户偏好与背景' },
          },
          output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
          async execute(args, exec) {
            const brief = core.envoyBrief(args);
            if (!brief) return '没有个体或没有任务，没有派出分身。';
            const subagents = ctx.get?.('subagents');
            if (!subagents?.startActivation || !exec?.agent) return '当前不能派分身。请你在这一轮里自己把事办完。';
            // 实测：分身会话也被注入了本性，会看到「用 chara_envoy」；只许主会话派，防止分身再派分身
            if (!mainSessions.has(String(exec.agent.session?.id))) return '你自己就是分身，不能再派分身。请直接把事办完，按简报汇报。';
            // 自带预设下分身改用设置里的预设：闲谈陪伴工具少；全能女仆的规则是写给拿主意的本体的，分身继承了会以为自己该派活。别的预设让分身继承
            const preset = OWN_PRESETS.includes(presetOf(exec.agent)) ? core.view.settings().envoyPreset : undefined;
            try {
              const { childId } = await subagents.startActivation({
                provider: 'spawn',
                label: [...String(args.task).trim()].slice(0, 20).join(''),
                delivery: 'parent',
                signal: exec.signal,
                request: { prompt: [{ type: 'text', text: brief }], parent: exec.agent, ...(preset ? { agentPreset: preset } : {}) },
              });
              envoys.set(childId, { session: String(exec.agent.session?.id ?? '?'), task: String(args.task).trim(), report: '' });
              return `分身 ${childId} 已出发。先告诉用户派它去办什么；它办完后你会收到汇报，核对后再转告。`;
            } catch (e) {
              log.warn('派分身失败：%s', e?.message ?? e);
              return `派分身失败（${e?.code ?? e?.message ?? e}）。请你在这一轮里自己把事办完。`;
            }
          },
        }),
      ),
    );
  });

  // 回想（M3 之前的简单版）：按关键词翻原话
  ctx.inject(['tools'], (c) => {
    c.effect(() =>
      c.tools.register(
        defineTool({
          name: 'chara_recall',
          description: '回想和用户以前聊过的事：用户提到过去的事、问你还记不记得、或你需要以前说过的细节时，按关键词翻你们的原话。',
          parameters: { query: { type: 'string', required: true, description: '关键词，越具体越好，如「猫的名字」写成「猫」' } },
          output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
          execute: async (args) => core.recall(args.query),
        }),
      ),
    );
  });

  // 界面挂在 DSH 自带的本机网页服务上；令牌每次启动重新生成，只通过 /chara ui 给出
  const UI_PATH = '/x-chara-soul';
  const token = randomBytes(16).toString('hex');
  ctx.inject(['webServer'], (c) => {
    c.effect(() => c.webServer.register({ kind: 'prefix', path: UI_PATH, handler: createUiHandler(core, { prefix: UI_PATH, token, onChange: () => sync(), presets: listPresets }) }));
  });
  const uiLink = () => {
    const port = ctx.get?.('webServer')?.port;
    return port ? `chara 界面：http://127.0.0.1:${port}${UI_PATH}/?t=${token}` : '没有找到 DSH 的网页服务，界面打不开。也可以在终端运行 npx chara ui。';
  };

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
        description: '角色灵魂引擎：new <名字> | import <角色卡路径> | list | use <名字> | show | reminisce <关键词> | profile | status | ui',
        input: { hint: 'new <名字> | import <角色卡路径> | list | use <名字> | show | reminisce <关键词> | profile | status | ui' },
        handler: async (inv) => {
          const raw = String(inv.rawInput ?? '').trim();
          if (raw === 'status') return { kind: 'success', text: status(inv) };
          if (raw === 'ui') return { kind: 'success', text: uiLink() };
          const r = core.command(raw);
          sync();
          let text = r.text;
          if (raw === 'show' && lastAssembly) {
            const mark = (list, n) => `${n} ${list.includes(n) ? '✓' : '✗'}`;
            text += `\n\n【上次实际组装】\n${mark(lastAssembly.sections, 'chara:nature')}（系统提示）  ${mark(lastAssembly.contexts, 'chara:moment')}（运行时上下文）`;
            const preset = presetOf(inv.agent);
            if (preset) text += `\n\n【当前预设】${preset}${OWN_PRESETS.includes(preset) ? '' : '。人格前缀（deployment:persona-prefix）来自这个预设，可能写着「coding agent」，和本性冲突；建议陪聊选「Soul·闲谈陪伴」、干活选「Soul·全能女仆」'}`;
            text += `\n\n【其他插件注入的段】\n系统提示：${groupSections(lastAssembly.sections) || '无'}\n运行时上下文：${groupSections(lastAssembly.contexts) || '无'}`;
          }
          return { kind: r.ok ? 'success' : 'error', text };
        },
      }),
    );
  });
}
