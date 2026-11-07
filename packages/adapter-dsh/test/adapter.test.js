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
  const services = {
    systemPrompt: {
      section: (s) => (live.sections.set(s.name, s), () => live.sections.delete(s.name)),
      context: (c) => (live.contexts.set(c.name, c), () => live.contexts.delete(c.name)),
      getSectionOrder: () => 0,
      getContextOrder: () => undefined,
    },
    commands: { register: (c) => commands.push(c) },
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
  return { ctx, live, emit, run };
}

const userMsg = (text, rpcId) => ({ role: 'user', source: rpcId ? { kind: 'user', rpcId, clientTimeZone: 'Asia/Shanghai' } : { kind: 'user' }, content: [{ type: 'text', text }] });
const asstMsg = (text) => ({ turn: 1, step: 1, message: { content: text ? [{ type: 'text', text }] : [{ type: 'tool-call' }] } });

test('适配器：没有个体不注入；创建后注入本性与此刻；只记主会话原话', async () => {
  const home = mkdtempSync(path.join(tmpdir(), '适配器 '));
  const core = createCore({ home, host: 'dsh' });
  try {
    const { ctx, live, emit, run } = fakeCtx();
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
  } finally {
    core.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('按前缀归类其他插件的段', () => {
  assert.equal(groupSections(['dsh-purge', 'dsh-purge:anchor', 'chara:nature', 'tool:read', 'tool:write', 'mnemon:routing']), 'dsh-purge（2 段）、tool（2 段）、mnemon');
});
