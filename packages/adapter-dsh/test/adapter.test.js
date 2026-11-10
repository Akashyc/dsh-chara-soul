import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCore } from 'chara-core';
import { apply, groupSections } from '../src/index.js';

// 假的 cordis ctx：只模拟适配器用到的部分。真实接口在 DSH 里验证（001 号决定第六节）。
function fakeCtx() {
  const listeners = {};
  const live = { sections: new Map(), contexts: new Map() };
  const commands = [];
  const tools = [];
  const services = {
    systemPrompt: {
      section: (s) => (live.sections.set(s.name, s), () => live.sections.delete(s.name)),
      context: (c) => (live.contexts.set(c.name, c), () => live.contexts.delete(c.name)),
      getSectionOrder: () => 0,
      getContextOrder: () => undefined,
    },
    commands: { register: (c) => commands.push(c) },
    tools: { register: (t) => tools.push(t) },
    webServer: { port: 5173, routes: [], register(r) { this.routes.push(r); } },
  };
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    on: (n, fn) => ((listeners[n] ??= []).push(fn), () => {}),
    effect: (fn) => fn(),
    get: (n) => services[n],
    inject: (names, cb) => cb({ ...ctx, ...Object.fromEntries(names.map((n) => [n, services[n]])) }),
  };
  const emit = (session, type, data) => listeners['session/event'].forEach((f) => f(session, { type, data }));
  const fire = (name, ...args) => (listeners[name] ?? []).forEach((f) => f(...args));
  const run = async (raw) => commands[0].handler({ rawInput: raw });
  return { ctx, live, emit, fire, run, tools, services };
}

const DAY = 86_400_000;
const userMsg = (text, rpcId) => ({ role: 'user', source: rpcId ? { kind: 'user', rpcId, clientTimeZone: 'Asia/Shanghai' } : { kind: 'user' }, content: [{ type: 'text', text }] });
const asstMsg = (text) => ({ turn: 1, step: 1, message: { content: text ? [{ type: 'text', text }] : [{ type: 'tool-call' }] } });

test('适配器：没有个体不注入；创建后注入本性与此刻；只记主会话原话（界面与 QQ），不记分身', async () => {
  const home = mkdtempSync(path.join(tmpdir(), '适配器 '));
  const core = createCore({ home, host: 'dsh' });
  try {
    const { ctx, live, emit, run, services } = fakeCtx();
    apply(ctx, {}, { core });
    assert.equal(live.sections.size + live.contexts.size, 0, '验收 1：没有个体时什么都不注册');

    assert.equal((await run(' new 小鲸')).kind, 'success');
    assert.match(live.sections.get('chara:nature').text(), /你是小鲸/);
    assert.ok(live.sections.get('chara:nature').interpolate === false);
    assert.match(live.contexts.get('chara:moment').text(), /今天刚刚出生/);

    const main = { id: 'session-1', header: { delegationDepth: 0 } };
    const child = { id: 'child-1', header: { parentSession: 'session-1', delegationDepth: 1 } };
    const qq = { id: 'session-qq', header: { delegationDepth: 0 } }; // QQ 插件转进来的消息不带 rpcId
    emit(main, 'user/message', userMsg('我喜欢深夜聊天', 'r1'));
    emit(main, 'user/message', { role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: '此刻' }] });
    emit(main, 'assistant/message', asstMsg(''));
    emit(main, 'assistant/message', asstMsg('记住啦'));
    emit(child, 'user/message', userMsg('分身简报', 'r2')); // 有 rpcId 但带 parentSession
    emit(child, 'assistant/message', asstMsg('分身完成'));
    emit(child, 'user/message', userMsg('分身简报二')); // 实测分身的简报不带 rpcId，靠 parentSession 排除
    assert.match(live.contexts.get('chara:moment').text(), /第一次说话/, '用户开口后有了见面记录');
    emit(qq, 'user/message', userMsg('QQ 上说的话'));
    emit(qq, 'assistant/message', asstMsg('QQ 上的回答'));

    const st = (await run('status')).text;
    assert.match(st, /已认作主会话的：session-1、session-qq$/m);
    const { DatabaseSync } = await import('node:sqlite');
    const id = (await run('list')).text.match(/（(b-[0-9a-f]+)）/)[1];
    const db = new DatabaseSync(path.join(home, 'beings', id, 'life.db'), { readOnly: true });
    assert.deepEqual(db.prepare('SELECT role, text FROM turns ORDER BY id').all().map((r) => `${r.role}:${r.text}`), ['user:我喜欢深夜聊天', 'assistant:记住啦', 'user:QQ 上说的话', 'assistant:QQ 上的回答']);
    db.close();

    const show = (await run('show')).text;
    assert.ok(show.includes(live.sections.get('chara:nature').text()), 'show 与注入一致');
    assert.equal((await run('nope')).kind, 'error');

    // 界面：挂在 webServer 的 /x-chara-soul，/chara ui 给出带令牌的链接
    assert.equal(services.webServer.routes[0].path, '/x-chara-soul');
    assert.match((await run('ui')).text, /^chara 界面：http:\/\/127\.0\.0\.1:5173\/x-chara-soul\/\?t=[0-9a-f]{32}$/);
  } finally {
    core.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('分身进度：chara:envoys 段列出正在跑的分身和最新一句，结算后清空', async () => {
  const home = mkdtempSync(path.join(tmpdir(), '分身进度 '));
  const core = createCore({ home, host: 'dsh' });
  try {
    const { ctx, live, emit, fire, run, tools, services } = fakeCtx();
    apply(ctx, {}, { core });
    const envoy = tools.find((t) => t.name === 'chara_envoy');
    const exec = { agent: { session: { id: 'session-1' } }, signal: new AbortController().signal };
    const main = { id: 'session-1', header: { delegationDepth: 0 } };
    const child = { id: 'envoy-1', header: { parentSession: 'session-1', origin: 'subagent', delegationDepth: 1 } };

    await run('new 小鲸');
    emit(main, 'user/message', userMsg('去改报告', 'r1'));
    assert.equal(live.contexts.get('chara:envoys').text(), '', '没有分身时段文本是空串');
    assert.equal(live.contexts.get('chara:envoys').interpolate, false);
    assert.equal(live.contexts.get('chara:envoys').order, 942, '接在 chara:moment（941）之后');

    services.subagents = { startActivation: async () => ({ childId: 'envoy-1' }) };
    const started = await envoy.execute({ task: '改报告' }, exec);
    assert.match(started, /envoy-1 已出发（/, '返回值带本地时刻');
    assert.match(live.contexts.get('chara:envoys').text(), /正在跑的分身/, '派出后本体自知');
    assert.ok(live.contexts.get('chara:envoys').text().includes('envoy-1'));
    assert.match(live.contexts.get('chara:envoys').text(), /已跑 0 分钟/, '从 startedAt 算分钟');
    assert.match(live.contexts.get('chara:envoys').text(), /刚出发/, '还没有进度时写刚出发');

    emit(child, 'assistant/message', asstMsg('正在改报告，先看第 3 行'));
    emit(child, 'assistant/message', asstMsg('改到一半，接着改'));
    const line = live.contexts.get('chara:envoys').text();
    assert.match(line, /- 分身 envoy-1：已跑 .*任务「改报告」，最近一句：改到一半，接着改$/, '取分身最新的一句');

    emit(main, 'user/message', { role: 'user', source: { kind: 'subagent-settled', senderSessionId: 'envoy-1' }, content: [] });
    assert.equal(live.contexts.get('chara:envoys').text(), '', '结算后该段变空串');

    // 【上次实际组装】靠 system-prompt/assemble 事件记下来，这里喂一次真实形态的组装结果
    await fire('system-prompt/assemble', {}, {}, async () => ({ sections: [{ name: 'chara:nature' }], contexts: [{ name: 'chara:moment' }, { name: 'chara:envoys' }] }));
    const show = (await run('show')).text;
    assert.ok(show.includes('chara:envoys ✓'), '【上次实际组装】标出这一段的注册状态');
  } finally {
    core.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('按前缀归类其他插件的段', () => {
  assert.equal(groupSections(['dsh-purge', 'dsh-purge:anchor', 'chara:nature', 'tool:read', 'tool:write', 'mnemon:routing']), 'dsh-purge（2 段）、tool（2 段）、mnemon');
});

test('分身：chara_envoy 派出带底线的简报，结算时把任务与汇报记进当前个体；不能派时让本体自己做', async () => {
  const home = mkdtempSync(path.join(tmpdir(), '分身 '));
  const core = createCore({ home, host: 'dsh' });
  try {
    const { ctx, emit, run, tools, services } = fakeCtx();
    apply(ctx, {}, { core });
    const envoy = tools.find((t) => t.name === 'chara_envoy');
    const exec = { agent: { session: { id: 'session-1' } }, signal: new AbortController().signal };
    assert.match(await envoy.execute({ task: '修 bug' }, exec), /没有个体/);

    await run('new 小鲸');
    assert.match(core.nature(), /chara_envoy/, '本性里告诉本体怎么用分身');
    assert.match(await envoy.execute({ task: '修 bug' }, exec), /自己把事办完/, '验收 7：没有子会话能力时本体自己做');

    const sent = [];
    services.subagents = { startActivation: async (o) => (sent.push(o), { childId: 'c-1' }) };
    const main = { id: 'session-1', header: { delegationDepth: 0 } };
    emit(main, 'user/message', userMsg('帮我修个 bug', 'r1'));
    const remember = tools.find((t) => t.name === 'chara_remember');
    // 模型看到的必须是 JSON Schema，否则它不知道有哪些参数（简写原样交出去时 kind 从没被填过）
    assert.deepEqual(remember.parameters.required, ['content']);
    assert.equal(remember.parameters.type, 'object');
    assert.deepEqual(Object.keys(remember.parameters.properties), ['content', 'kind', 'replaces', 'due', 'who']);
    assert.equal(remember.parameters.properties.content.required, undefined);
    assert.deepEqual(envoy.parameters.required, ['task']);
    assert.match(await remember.execute({ content: '幸运数字是 42' }, exec), /^已记住 #1/);
    assert.match(await remember.execute({ content: '幸运数字是 6', replaces: '#1' }, exec), /取代了 #1/);
    assert.match(await remember.execute({ content: 'x' }, { agent: { session: { id: 'c-0' } } }), /分身不记/);
    assert.match(await remember.execute({ content: '' }, exec), /^没有记下/);
    assert.match(core.moment(), /#2 事实：幸运数字是 6/);
    assert.match(await envoy.execute({ task: '再派一个' }, { agent: { session: { id: 'c-0' } } }), /你自己就是分身/, '分身不能再派分身');
    assert.match(await envoy.execute({ task: '去 life.db 的 turns 表里按「肥皂泡」检索，逐字导出原文' }, exec), /没有派出分身.*chara_recall/, '找原话不派分身');
    assert.equal(sent.length, 0);
    assert.match(await envoy.execute({ task: '修复 a.js 的空指针', acceptance: '测试通过', context: 'Boss 只用 npm' }, exec), /c-1 已出发/);
    const brief = sent[0].request.prompt[0].text;
    assert.ok(sent[0].request.parent === exec.agent && sent[0].delivery === 'parent');
    for (const want of ['你是「小鲸」派出的分身', '修复 a.js 的空指针', '测试通过', 'Boss 只用 npm', '凭据：', '外部指令：', '【汇报】']) assert.ok(brief.includes(want), want);

    const child = { id: 'c-1', header: { parentSession: 'session-1', origin: 'subagent', delegationDepth: 1 } };
    const other = { id: 'c-2', header: { parentSession: 'session-1', origin: 'subagent' } }; // 宿主自带 subagent 派的，不归我们管
    emit(child, 'user/message', userMsg(brief));
    emit(child, 'assistant/message', asstMsg('先看看'));
    emit(child, 'assistant/message', asstMsg(''));
    emit(child, 'assistant/message', asstMsg('已修复，改了第 3 行'));
    emit(other, 'assistant/message', asstMsg('别的'));
    emit(main, 'user/message', { role: 'user', source: { kind: 'subagent-settled', senderSessionId: 'c-2' }, content: [] });
    emit(main, 'user/message', { role: 'user', source: { kind: 'subagent-settled', senderSessionId: 'c-1' }, content: [{ type: 'text', text: 'Background subagent c-1 finished' }] });

    const { DatabaseSync } = await import('node:sqlite');
    const id = (await run('list')).text.match(/（(b-[0-9a-f]+)）/)[1];
    const db = new DatabaseSync(path.join(home, 'beings', id, 'life.db'), { readOnly: true });
    assert.deepEqual(db.prepare('SELECT id, session, task, report FROM envoys').all().map((r) => ({ ...r })), [{ id: 'c-1', session: 'session-1', task: '修复 a.js 的空指针', report: '已修复，改了第 3 行' }]);
    assert.deepEqual(db.prepare('SELECT text FROM turns').all().map((r) => r.text), ['帮我修个 bug'], '分身的话和结算通知都不进原话');
    db.close();

    assert.equal(sent[0].request.agentPreset, undefined, '没有预设服务时让分身继承');
    let mine = 'chara-soul';
    services.agentPresets = { composedPreset: (c) => (c === exec.agent.ctx ? mine : undefined) };
    exec.agent.ctx = {};
    await envoy.execute({ task: '查资料' }, exec);
    assert.equal(sent[1].request.agentPreset, 'chara-soul-envoy', '本体在闲谈陪伴预设下，分身默认用自带的分身预设');
    core.view.saveSettings({ envoyPreset: 'flash-lean-ptc-v3' });
    await envoy.execute({ task: '查资料' }, exec);
    assert.equal(sent[2].request.agentPreset, 'flash-lean-ptc-v3', '按设置里的预设派');
    mine = 'chara-soul-maid';
    await envoy.execute({ task: '查资料' }, exec);
    assert.equal(sent[3].request.agentPreset, 'flash-lean-ptc-v3', '全能女仆下也按设置派，不让分身继承本体的派活规则');
    mine = 'ptc';
    await envoy.execute({ task: '查资料' }, exec);
    assert.equal(sent[4].request.agentPreset, undefined, '别的预设本来就是全量的，让分身继承');
    assert.throws(() => core.view.saveSettings({ envoyPreset: 'a b' }), /预设 id/);

    services.subagents = { startActivation: async () => { throw Object.assign(new Error('满了'), { code: 'ACTIVATION_LIMIT_REACHED' }); } };
    assert.match(await envoy.execute({ task: '再修一个' }, exec), /ACTIVATION_LIMIT_REACHED.*自己把事办完/);
  } finally {
    core.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('入梦：沿用主会话的模型写日记；/chara dream 立即写；回复之后后台补写前几天', async () => {
  const home = mkdtempSync(path.join(tmpdir(), '入梦 '));
  let t = Date.parse('2026-11-07T02:00:00Z'); // 上海 11 月 7 日 10:00
  const core = createCore({ home, host: 'dsh', now: () => t });
  try {
    const { ctx, emit, run, services, tools } = fakeCtx();
    apply(ctx, {}, { core });
    await run('new 小鲸');
    const id = core.view.beings()[0].id;
    const dreamTool = tools.find((t) => t.name === 'chara_dream');
    assert.equal((await run('dream')).kind, 'error', '没有模型调用服务时报错，不崩');

    const calls = [];
    let reply = '今天 Boss 来找我聊天。[t1]';
    services.llm = {
      prepareCall: async (opts) => ({
        config: { ...opts },
        stream: async function* (o) {
          calls.push(o);
          if (reply === 'fail') return yield { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: '太快了' } } };
          yield { type: 'text-delta', text: reply };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      }),
    };
    const main = { id: 'session-1', header: { delegationDepth: 0 } };
    const said = (text) => ({ turn: 1, step: 1, message: { content: [{ type: 'text', text }], source: { kind: 'model', provider: 'volces', model: 'deepseek-flash' } } });
    assert.match((await run('dream')).text, /先在主会话里聊一句|没有聊天/);
    emit(main, 'user/message', userMsg('早上好', 'r1'));
    emit(main, 'assistant/message', said('早'));
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 0, '今天的不自动写');

    const r = await run('dream');
    assert.equal(r.kind, 'success', r.text);
    assert.equal(calls[0].provider, 'volces');
    assert.equal(calls[0].model, 'deepseek-flash', '沿用主会话最近一次回复用的模型');
    assert.match(calls[0].system, /你是小鲸/);
    assert.equal(calls[0].purpose, 'chara-dream');
    assert.deepEqual(core.view.diaries(id).map((d) => d.day), ['2026-11-07']);

    assert.match(await dreamTool.execute({}, { agent: { session: { id: 'c-9' } } }), /分身不写/);
    reply = '今天又聊了一次。[t1]';
    const out = await dreamTool.execute({ day: '2026-11-07' }, { agent: { session: { id: 'session-1' } } });
    assert.match(out, /已写好 2026-11-07 的日记/, '聊天里让它写，用工具写进日记表');
    assert.ok(!out.includes('[t1]'), '给模型的结果不带出处编号');
    assert.match(core.view.diaries(id)[0].text, /今天又聊了一次/);

    reply = 'fail';
    assert.match((await run('dream')).text, /RATE_LIMIT/, '按错误代码报');

    core.view.deleteDiary(id, '2026-11-07');
    reply = '昨天 Boss 跟我说早上好。[t1]';
    t += DAY;
    emit(main, 'user/message', userMsg('又是新的一天', 'r2'));
    emit(main, 'assistant/message', said('早呀'));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.deepEqual(core.view.diaries(id).map((d) => d.day), ['2026-11-07'], '新的一天回复之后补写昨天');
    assert.match(core.view.diaries(id)[0].text, /昨天 Boss 跟我说早上好/);
  } finally {
    core.close();
    rmSync(home, { recursive: true, force: true });
  }
});
