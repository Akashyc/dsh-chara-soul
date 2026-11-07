import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 用假的 cordis ctx 跑一遍 apply，只验证探针自身的逻辑；真实接口要在 DSH 里验证。
function fakeCtx() {
  const listeners = {};
  const reg = { sections: [], contexts: [], tools: [], commands: [] };
  const services = {
    systemPrompt: {
      section: (s) => reg.sections.push(s),
      context: (c) => reg.contexts.push(c),
      getSectionOrder: () => 0,
      getContextOrder: () => undefined,
    },
    tools: { register: (t) => reg.tools.push(t) },
    commands: { register: (c) => reg.commands.push(c) },
  };
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    on: (name, fn) => ((listeners[name] ??= []).push(fn), () => {}),
    effect: (fn) => fn(),
    get: (name) => services[name],
    inject: (names, cb) => cb({ ...ctx, ...Object.fromEntries(names.map((n) => [n, services[n]])) }),
  };
  return { ctx, listeners, reg };
}

test('探针：注册、记原话并剔除运行时上下文、命令可用', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), '探针 '));
  process.env.CHARA_SOUL_HOME = dir;
  const { ctx, listeners, reg } = fakeCtx();
  try {
    const { apply, messageText } = await import('../src/index.js');
    apply(ctx);

    assert.equal(reg.sections[0].name, 'chara:nature');
    assert.equal(reg.sections[0].order, 1);
    assert.equal(reg.contexts[0].order, 941, '查不到顺序名时用 940 兜底');
    assert.equal(reg.tools[0].name, 'chara_probe_recall');

    const emit = (type, data) => listeners['session/event'].forEach((f) => f({ id: 's1' }, { type, data }));
    emit('turn/start', { turn: 1 });
    // 形状照 DSH 实测：user/message 的 data 就是消息本身，assistant/message 的 data 是 { turn, step, message }
    emit('user/message', { role: 'user', source: { kind: 'user', rpcId: 'r1' }, content: [{ type: 'text', text: '我喜欢深夜聊天' }] });
    emit('user/message', { role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: '此刻' }] });
    emit('user/message', { role: 'user', source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: '技能目录' }] });
    emit('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'tool-call', name: 'x' }] } });
    emit('assistant/message', { turn: 1, step: 2, message: { content: [{ type: 'text', text: '记住啦' }] } });
    emit('turn/end', { turn: 1, reason: { kind: 'completed' } });
    // 分身会话：提示来源是 user 但没有 rpcId，不算主会话
    const child = (type, data) => listeners['session/event'].forEach((f) => f({ id: 'c1' }, { type, data }));
    child('user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '分身任务简报' }] });
    child('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '分身完成' }] } });
    assert.match(reg.contexts[0].text(), /第 1 轮/);

    const hits = await reg.tools[0].execute({ query: '深夜聊' });
    assert.match(hits, /我喜欢深夜聊天/);
    assert.doesNotMatch(await reg.tools[0].execute({ query: '此刻' }), /此刻/, '运行时上下文没有落库');
    assert.doesNotMatch(await reg.tools[0].execute({ query: '技能目录' }), /技能目录/, '其他来源也没有落库');

    const run = (raw) => reg.commands[0].handler({ rawInput: raw, signal: AbortSignal.timeout(1000) });
    const status = await run('');
    assert.equal(status.kind, 'success');
    assert.match(status.text, /✓ sqlite/);
    assert.match(status.text, /原话已记 2 条，剔除 \{"runtime-context":1,"skill-catalog":1,"非主会话":2\}，turn\/end：completed/);
    assert.match(status.text, /s1 事件 7 条，主会话/);
    assert.match(status.text, /c1 事件 2 条，非主会话/);
    assert.doesNotMatch(await reg.tools[0].execute({ query: '分身任务' }), /简报/, '分身会话不落库');
    assert.equal((await run(' nope')).kind, 'error');
    assert.match((await run(' llm')).text, /没有 llm.prepareCall/);

    assert.equal(messageText({ content: '纯文本' }), '纯文本');
  } finally {
    listeners.dispose?.forEach((f) => f()); // 先关库，Windows 上才删得掉目录
    delete process.env.CHARA_SOUL_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});
