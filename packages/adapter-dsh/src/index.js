// M1 接口验证探针：逐项验证 docs/decisions/001-dsh-接口.md 第六节的待办。
// 只用命名导出：有 export default 时 DSH 加载器会丢掉 inject 与 Config。
import path from 'node:path';
// shortcut: 相对路径引用 core，不走包依赖；M2 正式接线时改成依赖 chara-core。
import { dataHome, ensureHome, syncFolderWarning, openDb, migrate, ftsIndex, search } from '../../core/src/store/index.js';

// 宿主路由提供 @deepseek-ai/dsh-tools；本地测试时没有，退化为原样返回。
const { defineTool } = await import('@deepseek-ai/dsh-tools').catch(() => ({ defineTool: (d) => d }));

export const name = 'chara-soul';
export const inject = [];

const NATURE = '【chara 探针 · 本性段】这是 dsh-chara-soul 的固定测试文字，用来核对系统提示段是否注入成功。';

const TURNS_V1 = `CREATE TABLE turns (
  id INTEGER PRIMARY KEY,
  session TEXT NOT NULL,
  turn INTEGER,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  raw TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`;

/** 从消息里取出纯文本。 */
export function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
}

/**
 * user/message 不全是用户说的话：运行时上下文、技能目录、时间、别的插件、分身完成通知都以它出现。
 * 实测来源有 user / runtime-context / skill-catalog / time-context / dsh-mnemon / subagent-settled，
 * 所以只认 source.kind === 'user'，而不是逐个排除。
 */
export const isUserSpeech = (message) => message?.source?.kind === 'user';

/**
 * 用户在界面里打的字带 rpcId（客户端请求号）；分身与 mnemon 后台任务收到的提示只有 { kind: 'user' }。
 * shortcut: 用 rpcId 判断主会话，接入 QQ 等非界面来源（第三期）时改用宿主正式的父子字段。
 */
export const isFromClient = (message) => isUserSpeech(message) && typeof message.source.rpcId === 'string';

/** 取 header 的概要，用来找宿主有没有正式的父子字段。 */
const headerBrief = (h) => (h && typeof h === 'object' ? JSON.stringify(h, (k, v) => (typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : v)).slice(0, 300) : String(h));

const SERVICES = ['systemPrompt', 'tools', 'commands', 'llm', 'subagents', 'agents'];

export function apply(ctx) {
  const log = ctx.logger?.('chara-soul') ?? console;
  const report = new Map();
  const mark = (key, ok, detail = '') => {
    const line = `${ok ? '✓' : '✗'} ${key}${detail ? '：' + detail : ''}`;
    report.set(key, line);
    (ok ? log.info : log.warn).call(log, line);
  };
  const stats = { turns: 0, filtered: {}, turnEnds: [], sessions: new Map() };
  let turnNo = 0;
  let lastAssembly;

  // 第 3 条：node:sqlite 与数据目录
  let store;
  try {
    const home = ensureHome(dataHome());
    store = openDb(path.join(home, 'probe.db'));
    migrate(store, [TURNS_V1, (s) => ftsIndex(s, 'turns', ['text'])]);
    const ver = store.db.prepare('SELECT sqlite_version() v').get().v;
    mark('sqlite', true, `SQLite ${ver}，trigram ${store.fts ? '可用' : '不可用'}，${home}`);
    const warn = syncFolderWarning(home);
    if (warn) mark('数据目录', false, warn);
  } catch (e) {
    mark('sqlite', false, e.message);
  }
  ctx.on?.('dispose', () => store?.db.close());

  // 第 4、5 条：本性走系统提示段，此刻走运行时上下文
  ctx.inject(['systemPrompt'], (c) => {
    const sp = c.systemPrompt;
    try {
      c.effect(() => sp.section({ name: 'chara:nature', order: (sp.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') ?? 0) + 1, interpolate: false, text: NATURE }));
      mark('section', true);
    } catch (e) {
      mark('section', false, e.message);
    }
    try {
      c.effect(() => sp.context({ name: 'chara:moment', order: (sp.getContextOrder('WORKING_DIRECTORY') ?? 940) + 1, interpolate: false, text: () => `【chara 探针 · 此刻】第 ${turnNo} 轮。` }));
      mark('context', true);
    } catch (e) {
      mark('context', false, e.message);
    }
  });

  // 002 号决定：能否读到完整组装结果与各段来源
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const out = await next();
    lastAssembly = {
      keys: Object.keys(out ?? {}),
      sections: (out?.sections ?? []).map((s) => s?.name ?? '?'),
      contexts: (out?.contexts ?? []).map((s) => s?.name ?? '?'),
    };
    return out;
  });

  // 第 6 条：从事件流取原话
  ctx.on('session/event', (session, event) => {
    try {
      const d = event?.data ?? {};
      const sid = String(session?.id ?? '?');
      // 分身、mnemon 后台任务也有自己的会话，事件同样广播到这里
      if (!stats.sessions.has(sid)) stats.sessions.set(sid, { header: headerBrief(session?.header), main: false, n: 0 });
      const info = stats.sessions.get(sid);
      info.n++;
      if (event?.type === 'turn/start') turnNo++;
      if (event?.type === 'turn/end') stats.turnEnds.push(d.reason?.kind ?? '?');
      if (event?.type !== 'user/message' && event?.type !== 'assistant/message') return;
      // 实测：user/message 的 data 就是消息本身；assistant/message 的 data 是 { turn, step, message }
      const message = d.message ?? d;
      const role = event.type === 'user/message' ? 'user' : 'assistant';
      if (role === 'user' && !isUserSpeech(message)) {
        const k = message?.source?.kind ?? '?';
        stats.filtered[k] = (stats.filtered[k] ?? 0) + 1;
        return;
      }
      // 实测 header：分身会话带 parentSession、origin: 'subagent'、delegationDepth ≥ 1；mnemon 后台会话的 header 没见过，靠 rpcId 兜住
      if (role === 'user' && isFromClient(message) && !session?.header?.parentSession) info.main = true;
      if (!info.main) return void (stats.filtered['非主会话'] = (stats.filtered['非主会话'] ?? 0) + 1);
      const text = messageText(message);
      if (!text.trim()) return; // 只有工具调用、没说话的步骤不记
      store?.db.prepare('INSERT INTO turns (session, turn, role, text, raw) VALUES (?, ?, ?, ?, ?)').run(sid, d.turn ?? null, role, text, JSON.stringify(d).slice(0, 4000));
      stats.turns++;
    } catch (e) {
      log.warn('记录原话失败：%s', e?.message ?? e);
    }
  });

  // 第 7 条：工具
  ctx.inject(['tools'], (c) => {
    try {
      c.effect(() =>
        c.tools.register(
          defineTool({
            name: 'chara_probe_recall',
            description: '在本个体记得的过往对话原文里查找包含关键词的片段。用户问起以前聊过什么时使用。',
            parameters: { query: { type: 'string', required: true, description: '要找的关键词' } },
            output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
            isConcurrencySafe: () => true,
            async execute(args) {
              if (!store) return '记忆库不可用。';
              const rows = search(store, 'turns', 'text', String(args.query ?? ''), 10);
              return rows.length ? rows.map((r) => `[${r.at} ${r.role}] ${r.text.slice(0, 200)}`).join('\n') : '没有找到。';
            },
          }),
        ),
      );
      mark('tool', true);
    } catch (e) {
      mark('tool', false, e.message);
    }
  });

  // 第 7、8、9、11 条：命令
  const handlers = {
    status: (_args, inv) => {
      const caps = SERVICES.map((s) => `${ctx.get?.(s) ? '✓' : '✗'} ${s}`).join('  ');
      const spawn = ctx.get?.('subagents')?.getProvider?.('spawn') ? '✓' : '✗';
      return [
        ...report.values(),
        `服务：${caps}  spawn provider ${spawn}`,
        `原话已记 ${stats.turns} 条，剔除 ${JSON.stringify(stats.filtered)}，turn/end：${stats.turnEnds.slice(-5).join(', ') || '无'}`,
        `当前会话 ${inv.agent?.session?.id ?? '?'}；见过的会话：`,
        ...[...stats.sessions].map(([id, s]) => `  ${id} 事件 ${s.n} 条，${s.main ? "主会话" : "非主会话"}，header ${s.header}`),
      ].join('\n');
    },
    show: () =>
      [
        `本性段：${NATURE}`,
        `此刻：第 ${turnNo} 轮`,
        lastAssembly
          ? `上次组装字段：${lastAssembly.keys.join(', ')}\n系统提示段：${lastAssembly.sections.join(', ')}\n运行时上下文：${lastAssembly.contexts.join(', ')}`
          : '还没有拦截到组装结果',
      ].join('\n'),
    llm: async (args, inv) => {
      const llm = ctx.get?.('llm');
      if (!llm?.prepareCall) return '✗ 没有 llm.prepareCall';
      const [provider, model] = args;
      if (!provider) return `用法：/chara llm <provider> <model>。已注册的 provider：${JSON.stringify(llm.listProviders?.() ?? []).slice(0, 800)}`;
      const call = await llm.prepareCall({ provider, model, maxTokens: 64 }, inv.signal);
      let text = '';
      let finish;
      for await (const chunk of call.stream({ ...call.config, messages: [{ role: 'user', content: [{ type: 'text', text: '只回复两个字：收到' }] }], signal: inv.signal })) {
        if (chunk.type === 'text-delta') text += chunk.text;
        if (chunk.type === 'finish') finish = chunk.reason;
      }
      return finish?.kind === 'error' ? `✗ 补全失败 ${finish.failure?.code}：${finish.failure?.message}` : `✓ 补全结果：${text}（${finish?.kind}）`;
    },
    spawn: async (_args, inv) => {
      const subagents = ctx.get?.('subagents');
      if (!subagents?.startActivation) return '✗ 没有 subagents.startActivation';
      const act = await subagents.startActivation({
        provider: 'spawn',
        label: 'chara 探针分身',
        delivery: 'parent',
        signal: inv.signal,
        request: { prompt: [{ type: 'text', text: '这是一次接口测试。直接回复「探针分身已完成」，不要调用任何工具。' }], parent: inv.agent },
      });
      act.result.then(
        (r) => log.info('分身完成：%s', JSON.stringify(r).slice(0, 500)),
        (e) => log.warn('分身失败：%s', e?.message ?? e),
      );
      return `✓ 已派出分身 ${act.childId}，完成后父会话应收到通知`;
    },
  };

  ctx.inject(['commands'], (c) => {
    try {
      c.effect(() =>
        c.commands.register({
          name: 'chara',
          description: '角色灵魂引擎（接口探针）：status | show | llm <provider> <model> | spawn',
          input: { hint: 'status | show | llm <provider> <model> | spawn' },
          handler: async (inv) => {
            const [sub = 'status', ...args] = String(inv.rawInput ?? '').trim().split(/\s+/).filter(Boolean);
            const h = handlers[sub];
            if (!h) return { kind: 'error', text: `未知子命令 ${sub}` };
            try {
              return { kind: 'success', text: await h(args, inv) };
            } catch (e) {
              return { kind: 'error', text: `${sub} 出错：${e?.code ? e.code + ' ' : ''}${e?.message ?? e}` };
            }
          },
        }),
      );
      mark('command', true);
    } catch (e) {
      mark('command', false, e.message);
    }
  });
}
