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
  const run = async (raw) => commands[0].handler({ rawInput: raw });
  return { ctx, live, emit, run, tools, services };
}

const userMsg = (text, rpcId) => ({ role: 'user', source: rpcId ? { kind: 'user', rpcId, clientTimeZone: 'Asia/Shanghai' } : { kind: 'user' }, content: [{ type: 'text', text }] });
const asstMsg = (text) => ({ turn: 1, step: 1, message: { content: text ? [{ type: 'text', text }] : [{ type: 'tool-call' }] } });

test('适配器：没有个体不注入；创建后注入本性与此刻；只记主会话原话', async () => {
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
    const bg = { id: 'mnemon-run-1', header: {} };
    emit(main, 'user/message', userMsg('我喜欢深夜聊天', 'r1'));
    emit(main, 'user/message', { role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: '此刻' }] });
    emit(main, 'assistant/message', asstMsg(''));
    emit(main, 'assistant/message', asstMsg('记住啦'));
    emit(child, 'user/message', userMsg('分身简报', 'r2')); // 有 rpcId 但带 parentSession
    emit(child, 'assistant/message', asstMsg('分身完成'));
    emit(bg, 'user/message', userMsg('后台任务'));
    emit(bg, 'assistant/message', asstMsg('后台结果'));

    const st = (await run('status')).text;
    assert.match(st, /已认作主会话的：session-1$/m);
    assert.match(live.contexts.get('chara:moment').text(), /第一次说话/, '用户开口后有了见面记录');
    const { DatabaseSync } = await import('node:sqlite');
    const id = (await run('list')).text.match(/（(b-[0-9a-f]+)）/)[1];
    const db = new DatabaseSync(path.join(home, 'beings', id, 'life.db'), { readOnly: true });
    assert.deepEqual(db.prepare('SELECT role, text FROM turns ORDER BY id').all().map((r) => `${r.role}:${r.text}`), ['user:我喜欢深夜聊天', 'assistant:记住啦']);
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
    assert.match(await envoy.execute({ task: '再派一个' }, { agent: { session: { id: 'c-0' } } }), /你自己就是分身/, '分身不能再派分身');
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

    services.subagents = { startActivation: async () => { throw Object.assign(new Error('满了'), { code: 'ACTIVATION_LIMIT_REACHED' }); } };
    assert.match(await envoy.execute({ task: '再修一个' }, exec), /ACTIVATION_LIMIT_REACHED.*自己把事办完/);
  } finally {
    core.close();
    rmSync(home, { recursive: true, force: true });
  }
});
