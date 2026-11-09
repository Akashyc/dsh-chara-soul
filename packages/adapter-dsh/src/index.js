// DSH 适配器：尽量薄，只把宿主事件接到核心（架构方案第十二节，接口依据 docs/decisions/001-dsh-接口.md）。
// 只用命名导出：有 export default 时 DSH 加载器会丢掉 inject 与 Config。
// 相对路径而不是包名：发布的安装包里核心与适配器同在一个包内，没有 chara-core 这个依赖
import { createCore } from '../../core/src/index.js';
import { createUiHandler } from '../../ui/src/handler.js';
import { randomBytes } from 'node:crypto';

// 参数用简写（{ 名: { type, required, description } }），模型要的是 JSON Schema。
// @deepseek-ai/dsh-tools 的 defineTool 会转换，但从本插件的位置导入不到它（2026-11-09 实测：模型拿到的三个工具都没有参数），
// 所以导入不到时自己转，不能原样交出去。
/** 简写参数转成 JSON Schema。 */
export function toSchema(params = {}) {
  const properties = Object.fromEntries(Object.entries(params).map(([k, { required, ...rest }]) => [k, rest]));
  const required = Object.keys(params).filter((k) => params[k].required);
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}
const { defineTool } = await import('@deepseek-ai/dsh-tools').catch(() => ({ defineTool: (d) => ({ ...d, parameters: toSchema(d.parameters) }) }));

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
/** 自带的分身预设，设置里「分身用的预设」默认就是它。 */
export const ENVOY_PRESET = 'chara-soul-envoy';

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

  // 写日记用哪个模型：宿主没有全局默认，沿用主会话最近一次回复用的（宿主生成会话标题也是这么做的）
  let route = null;
  /**
   * 一次性补全（001 号决定第四节）：无会话、无工具、无历史。失败按 code 抛错，由调用方报给用户。
   * @returns 模型输出的正文
   */
  async function complete({ system, prompt, maxTokens }) {
    const llm = ctx.get?.('llm');
    if (!llm?.prepareCall) throw Object.assign(new Error('宿主没有模型调用服务'), { code: 'NO_LLM' });
    if (!route) throw Object.assign(new Error('还不知道用哪个模型，先在主会话里聊一句'), { code: 'NO_ROUTE' });
    const signal = AbortSignal.timeout(180_000);
    const call = await llm.prepareCall({ ...route, maxTokens }, signal);
    let text = '';
    for await (const chunk of call.stream({ ...call.config, system, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }], purpose: 'chara-dream', signal })) {
      if (chunk?.type === 'text-delta') text += chunk.text ?? '';
      else if (chunk?.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
        throw Object.assign(new Error(chunk.reason.failure?.message ?? '模型调用失败'), { code: chunk.reason.failure?.code ?? chunk.reason.kind });
      }
    }
    return text;
  }

  /** 界面和 /chara dream 用：写一篇日记，模型调用失败时把错误代码写进结果，不抛。 */
  async function writeDiary(id, day) {
    try {
      return await core.dream({ id: id || undefined, day: day || undefined, complete });
    } catch (e) {
      return { ok: false, text: `写日记失败（${e?.code ?? e?.message ?? e}）` };
    }
  }

  /** 界面放生时一键起草履历；模型调用失败时把错误代码写进结果，不抛。 */
  async function writeResume(id, sel) {
    try {
      return { ok: true, text: await core.releaseResume({ ...sel, id, complete }) };
    } catch (e) {
      return { ok: false, text: `起草履历失败（${e?.code ?? e?.message ?? e}）` };
    }
  }

  /** 醒来补做：把之前聊过天、还没写日记的日子补上。在回复之后后台写，不拖慢回复；同一时间只写一份。 */
  let dreaming = false;
  async function catchUp() {
    if (dreaming || !route) return;
    dreaming = true;
    try {
      for (const day of core.pendingDreams()) {
        const r = await core.dream({ day, complete });
        log.info('补写日记 %s：%s', day, r.ok ? '已写好' : r.text);
      }
    } catch (e) {
      log.warn('补写日记失败：%s', e?.code ?? e?.message ?? e);
    } finally {
      dreaming = false;
    }
  }

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

  // 分身登记表：子会话 id → { session, task, report, startedAt }，结算通知到达时落库并删除。
  // 必须声明在 systemPrompt 注入之前：sync() 注册的 chara:envoys 段引用它，挪到后面会踩暂时性死区（TDZ）。
  const envoys = new Map();

  /**
   * chara:envoys 段的文本：把还在跑的分身逐条列出来，让本体自己知道「现在有人在干、干了多久」。
   * 函数声明（不是 const 箭头）以便提升：sync() 在注入时就建好 text 闭包。
   * 没有分身时返回空串，宿主侧不产生 token（与 chara:moment 同一机制）。
   */
  function envoyLine() {
    if (envoys.size === 0) return '';
    const now = Date.now();
    const lines = [...envoys].map(([id, e]) => {
      const mins = Math.max(0, Math.floor((now - (e.startedAt ?? now)) / 60000));
      return `- 分身 ${id}：已跑 ${mins} 分钟，任务「${String(e.task ?? '').slice(0, 60)}」${e.report ? `，最近一句：${e.report.slice(0, 120)}` : '，刚出发'}`;
    });
    return `正在跑的分身：\n${lines.join('\n')}`;
  }

  // 本性走系统提示段，此刻走运行时上下文。没有个体时都不注册，什么都不注入（验收 1）
  let sync = () => {};
  ctx.inject(['systemPrompt'], (c) => {
    const sp = c.systemPrompt;
    let off = null;
    sync = () => {
      const want = core.nature() !== '';
      if (want && !off) {
        const a = sp.section({ name: 'chara:nature', order: (sp.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') ?? 0) + 1, interpolate: false, text: () => core.nature() });
        const b = sp.context({ name: 'chara:moment', order: (sp.getContextOrder('WORKING_DIRECTORY') ?? 940) + 1, interpolate: false, text: () => core.moment() });
        const ev = sp.context({ name: 'chara:envoys', order: (sp.getContextOrder('WORKING_DIRECTORY') ?? 940) + 2, interpolate: false, text: () => envoyLine() });
        off = () => (a(), b(), ev());
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
      const parent = session?.header?.parentSession;
      if (parent) {
        // 分身会话一律不记原话；我们派出的分身取最后一句非空回复作汇报
        // （分身先用 send_message 回报时，结算通知里会省略最后一句，所以不从通知里取）
        if (event.type === 'assistant/message' && envoys.has(sid)) {
          const t = messageText(message).trim();
          if (t) envoys.get(sid).report = t; // 结算时落库，跑的过程中也是 chara:envoys 段里的「最近一句」
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
        const src = message?.source;
        if (src?.provider && src?.model) route = { provider: src.provider, model: src.model };
        if (messageText(message).trim()) catchUp(); // 不 await：回复已经发出去了，日记在后台写
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
          description: '派一个分身去办手边没有工具办的事（写文件、跑命令等），或大批量、耗时长的活。立即返回；分身办完后你会收到它的汇报，核对后再用自己的话转告用户。派出当轮的回复里必须用一句话告诉用户你派它去办什么、大概多久——用户看不到工具返回，只能看到你说的话。',
          // 只收一个参数：flash 模型先写别的参数时，偶尔把后面的参数吞进第一个值里，task 就丢了（M10 实测）
          parameters: {
            task: { type: 'string', required: true, description: '要办的事：对象、范围与具体要求；怎样算办完；分身需要知道的用户偏好与背景' },
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
              const startedAt = Date.now();
              envoys.set(childId, { session: String(exec.agent.session?.id ?? '?'), task: String(args.task).trim(), report: '', startedAt });
              // 带上本地时刻，本体转述时手里有「几点出发」，用户至少拿到「还要多久」的锚点
              return `分身 ${childId} 已出发（${new Date(startedAt).toLocaleTimeString('zh-CN')}）。先告诉用户派它去办什么、大概多久；它办完后你会收到汇报，核对后再转告。`;
            } catch (e) {
              log.warn('派分身失败：%s', e?.message ?? e);
              return `派分身失败（${e?.code ?? e?.message ?? e}）。请你在这一轮里自己把事办完。`;
            }
          },
        }),
      ),
    );
  });

  // 回想：按关键词先翻记忆点，再翻原话
  ctx.inject(['tools'], (c) => {
    c.effect(() =>
      c.tools.register(
        defineTool({
          name: 'chara_recall',
          description: '回想和用户以前聊过的事：用户提到过去的事、问你还记不记得、或你需要以前说过的细节时，按关键词翻你记下的事和你们的原话。用户问起你的日记时，关键词写「日记」给最近一篇，写日期（YYYY-MM-DD）给那天的；日记在这里，不在文件里。',
          parameters: { query: { type: 'string', required: true, description: '关键词，越具体越好，如「猫的名字」写成「猫」' } },
          output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
          execute: async (args) => core.recall(args.query),
        }),
      ),
    );
  });

  // 记忆点：个体自己判断该记什么（2026-11-09 用户定），分身不记，写进汇报由本体决定
  ctx.inject(['tools'], (c) => {
    c.effect(() =>
      c.tools.register(
        defineTool({
          name: 'chara_remember',
          description: '把值得长久记住的事记下来：用户的喜好、事实、约定、改口、重要的经历和决定。闲聊、指令、测试不用记；此刻「记得的事」里已有的不要重复记。日记不要记在这里，用 chara_dream 写。',
          // content 放第一个：flash 模型偶尔把后面的参数吞进前一个字符串里，内容在最前面就不会丢（M10 实测）
          parameters: {
            content: { type: 'string', required: true, description: '要记的内容，一句话写清，200 字以内，如「用户的幸运数字是 6」' },
            kind: { type: 'string', enum: ['fact', 'preference', 'promise', 'event', 'decision', 'feeling', 'rule', 'lesson'], description: '类型填在这里，不要写进 content。fact 事实 | preference 喜好 | promise 约定 | event 事件 | decision 决定 | feeling 感受 | rule 规矩（用户对你做事的要求） | lesson 体会；不填当事实' },
            replaces: { type: 'string', description: '改口时填被取代的旧记忆编号，如 12；不是改口就不填' },
            due: { type: 'string', description: '约定的到期日，YYYY-MM-DD；没有就不填' },
            who: { type: 'string', description: '说这话的人：用户本人不填；QQ 群里别人说的写对方昵称' },
          },
          output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
          async execute(args, exec) {
            const sid = String(exec?.agent?.session?.id ?? '');
            if (exec?.agent && !mainSessions.has(sid)) return '分身不记记忆点；要紧的写进汇报，由本体决定记不记。';
            try {
              const r = core.remember({ ...args, session: sid || null });
              sync();
              return r;
            } catch (e) {
              return `没有记下：${e.message}`;
            }
          },
        }),
      ),
    );
  });

  // 写日记：用户在聊天里让它写时用，和界面按钮、/chara dream 走同一条路
  ctx.inject(['tools'], (c) => {
    c.effect(() =>
      c.tools.register(
        defineTool({
          name: 'chara_dream',
          description: '写日记：用户让你写（或重写）某天的日记时调用。系统按那天你们的原话和记下的事替你写好、存进日记，已有的会被替换。不要自己在回复里编日记，也不要用 chara_remember 记日记。',
          parameters: { day: { type: 'string', description: '哪天，YYYY-MM-DD；不填就是今天' } },
          output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
          async execute(args, exec) {
            const sid = String(exec?.agent?.session?.id ?? '');
            if (exec?.agent && !mainSessions.has(sid)) return '分身不写日记。';
            const r = await writeDiary(null, args.day);
            return r.text.replace(/\[[tm]\d+\]/g, ''); // 出处编号是给界面的
          },
        }),
      ),
    );
  });

  // 界面挂在 DSH 自带的本机网页服务上；令牌每次启动重新生成，只通过 /chara ui 给出
  const UI_PATH = '/x-chara-soul';
  const token = randomBytes(16).toString('hex');
  ctx.inject(['webServer'], (c) => {
    c.effect(() => c.webServer.register({ kind: 'prefix', path: UI_PATH, handler: createUiHandler(core, { prefix: UI_PATH, token, onChange: () => sync(), presets: listPresets, dream: writeDiary, resume: writeResume }) }));
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
      core.homeInfo().warning && `⚠️ ${core.homeInfo().warning}`,
    ].filter(Boolean).join('\n');

  ctx.inject(['commands'], (c) => {
    c.effect(() =>
      c.commands.register({
        name: 'chara',
        description: '角色灵魂引擎：new <名字> | import <角色卡路径> | list | use <名字> | sleep <名字> | wake <名字> | migrate <全部 | 画像 | 名字> | release | show | reminisce <关键词> | dream [日期] | profile | status | ui',
        input: { hint: 'new <名字> | import <角色卡路径> | list | use <名字> | sleep <名字> | wake <名字> | migrate <全部 | 画像 | 名字> | release | show | reminisce <关键词> | dream [日期] | profile | status | ui' },
        handler: async (inv) => {
          const raw = String(inv.rawInput ?? '').trim();
          if (raw === 'status') return { kind: 'success', text: status(inv) };
          if (raw === 'ui') return { kind: 'success', text: uiLink() };
          if (/^release\b/.test(raw)) return { kind: 'success', text: `${core.command('release').text}\n${uiLink()}` };
          const dream = /^dream(?:\s+(\S+))?$/.exec(raw);
          if (dream) {
            const r = await writeDiary(null, dream[1]);
            return { kind: r.ok ? 'success' : 'error', text: r.text };
          }
          const r = core.command(raw);
          sync();
          let text = r.text;
          if (raw === 'show' && lastAssembly) {
            const mark = (list, n) => `${n} ${list.includes(n) ? '✓' : '✗'}`;
            text += `\n\n【上次实际组装】\n${mark(lastAssembly.sections, 'chara:nature')}（系统提示）  ${mark(lastAssembly.contexts, 'chara:moment')}（运行时上下文）  ${mark(lastAssembly.contexts, 'chara:envoys')}（运行时上下文，分身进度）`;
            const preset = presetOf(inv.agent);
            if (preset) text += `\n\n【当前预设】${preset}${[...OWN_PRESETS, ENVOY_PRESET].includes(preset) ? '' : '。人格前缀（deployment:persona-prefix）来自这个预设，可能写着「coding agent」，和本性冲突；建议陪聊选「Soul·闲谈陪伴」、干活选「Soul·全能女仆」'}`;
            text += `\n\n【其他插件注入的段】\n系统提示：${groupSections(lastAssembly.sections) || '无'}\n运行时上下文：${groupSections(lastAssembly.contexts) || '无'}`;
          }
          return { kind: r.ok ? 'success' : 'error', text };
        },
      }),
    );
  });
}
