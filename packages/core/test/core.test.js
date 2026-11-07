import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCore } from 'chara-core';
import { floor5, daysBetween, relative, gap, timeLines } from '../src/chrono/index.js';
import { buildNature, BOTTOM_LINES } from '../src/nature/index.js';
import { readCard } from '../src/card/index.js';

const MIN = 60_000;
const DAY = 86_400_000;
const T0 = Date.parse('2026-11-07T15:58:00Z'); // 上海时间 11 月 7 日 23:58

function withHome(fn) {
  const home = mkdtempSync(path.join(tmpdir(), '核心 测试 '));
  let t = T0;
  const core = createCore({ home, now: () => t, host: 'test' });
  try {
    return fn({ core, home, tick: (ms) => (t += ms), at: () => t });
  } finally {
    core.close();
    rmSync(home, { recursive: true, force: true });
  }
}

test('时光：取整、跨午夜算天、相对时间、回拨', () => {
  assert.equal(floor5(T0 + 4 * MIN + 59_000), T0 - 3 * MIN + 5 * MIN); // 15:58 → 15:55，16:02:59 → 16:00
  assert.equal(daysBetween(T0, T0 + 3 * MIN, 'Asia/Shanghai'), 1, '23:58 到 00:01 跨过午夜算一天');
  assert.equal(daysBetween(T0, T0 + 3 * MIN, 'UTC'), 0);
  assert.equal(relative(3 * MIN), '刚刚');
  assert.equal(relative(2 * DAY + 5), '2 天');
  assert.equal(relative(40 * DAY), '1 个月');
  assert.deepEqual(gap(T0, T0 - MIN), { ms: 0, rewound: true });
  const lines = timeLines({ now: T0, born: T0 - 7 * DAY, prev: T0 - 7 * DAY, last: T0, tz: 'Asia/Shanghai' });
  assert.match(lines[0], /2026年11月7日/);
  assert.match(lines.join('\n'), /出生 7 天/);
  assert.match(lines.join('\n'), /过去了 7 天/);
});

test('本性：底线完整保留，超预算时先裁外貌', () => {
  const card = { name: '小鲸', personality: '懒，但认真起来很可靠', speech: '自称本鱼', appearance: '蓝'.repeat(500) };
  const full = buildNature(card, { call_me: 'Boss' }, 5000);
  assert.match(full, /你是小鲸/);
  assert.match(full, /你称呼用户为：Boss/);
  assert.ok(full.includes(BOTTOM_LINES));
  const tight = buildNature(card, null, 500);
  assert.ok(tight.includes(BOTTOM_LINES), '底线不裁');
  assert.match(tight, /自称本鱼/, '口吻优先于外貌保留');
  assert.ok([...tight].length <= 520);
  assert.equal(buildNature(card), buildNature(card), '同样输入逐字节相同');
});

test('角色卡：BOM 与 CRLF 都能读，缺名字报错', () => {
  const dir = mkdtempSync(path.join(tmpdir(), '卡 '));
  try {
    const f = path.join(dir, 'card.yaml');
    writeFileSync(f, '﻿name: 蒂普茜柯\r\nspeech: |\r\n  本鱼饿了\r\n');
    assert.equal(readCard(f).name, '蒂普茜柯');
    assert.equal(readCard(f).speech, '本鱼饿了\n');
    writeFileSync(f, 'speech: 嗯\n');
    assert.throws(() => readCard(f), /缺少 name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('验收 1：没有个体时什么都不注入', () =>
  withHome(({ core }) => {
    assert.equal(core.nature(), '');
    assert.equal(core.moment(), '');
    core.afterTurn({ session: 's', role: 'user', text: '在吗' }); // 不报错、不落库
    assert.match(core.command('show').text, /不注入任何内容/);
  }));

test('创建个体后本性出现，show 与注入逐字节一致', () =>
  withHome(({ core, home }) => {
    const r = core.command('new 蒂普茜柯');
    assert.ok(r.ok);
    assert.ok(r.text.match(/角色卡在 (.+card\.yaml)/)[1].startsWith(home));
    assert.match(core.nature(), /你是蒂普茜柯/);
    assert.doesNotMatch(core.command('show').text, /出生/, 'show 只看不唤醒，不会提前记下出生时刻');
    const injected = core.moment(); // 第一次注入即醒来
    const show = core.command('show').text;
    assert.ok(show.includes(core.nature()), 'show 里的本性就是注入的本性');
    assert.ok(show.includes(injected), 'show 里的此刻就是注入的此刻');
  }));

test('改卡下一轮生效；改坏了保留上一版，show 给出提示', () =>
  withHome(({ core }) => {
    const card = core.command('new 小鲸').text.match(/角色卡在 (.+card\.yaml)/)[1];
    const good = core.nature();
    // 文件系统 mtime 精度有限，显式改时间戳确保被识别为改动
    const touch = (s) => utimesSync(card, new Date(Date.now() + s * 1000), new Date(Date.now() + s * 1000));
    writeFileSync(card, readFileSync(card, 'utf8').replace('speech: |\n', 'speech: |\n  自称本鱼\n'));
    touch(2);
    assert.match(core.nature(), /自称本鱼/, '改卡后重建本性');
    writeFileSync(card, 'name: [坏掉');
    touch(4);
    assert.match(core.nature(), /自称本鱼/, '坏卡保留上一版');
    assert.notEqual(core.nature(), good);
    assert.match(core.command('show').text, /角色卡读取出错/);
  }));

test('时间与间隔：出生、距上次见面、5 分钟内此刻不变', () =>
  withHome(({ core, tick }) => {
    core.command('new 小鲸');
    assert.match(core.moment(), /今天刚刚出生/);
    core.afterTurn({ session: 's', role: 'user', text: '你好', tz: 'Asia/Shanghai' });
    assert.match(core.moment(), /第一次说话/);
    const m = core.moment();
    tick(MIN);
    assert.equal(core.moment(), m, '同一个 5 分钟内逐字节相同');

    tick(7 * DAY);
    core.afterTurn({ session: 's', role: 'user', text: '我回来了' });
    assert.match(core.moment(), /出生 7 天/);
    assert.match(core.moment(), /过去了 7 天/);
  }));

test('验收 8：两个个体互不相通，切走的个体时间照样流逝', () =>
  withHome(({ core, tick }) => {
    core.command('new 甲');
    core.afterTurn({ session: 's', role: 'user', text: '我的秘密是喜欢猫' });
    core.command('new 乙');
    assert.match(core.nature(), /你是乙/);
    core.afterTurn({ session: 's', role: 'user', text: '你好乙' });
    tick(3 * DAY);
    assert.ok(core.command('use 甲').ok);
    core.afterTurn({ session: 's', role: 'user', text: '我回来了' });
    assert.match(core.moment(), /过去了 3 天/);
    assert.match(core.command('list').text, /▶ 甲/);
    assert.equal(core.command('use 丙').ok, false);
  }));

test('原话按个体分库，cli 也能读（验收 10 的前提）', async () => {
  const { openLife } = await import('../src/memory/life.js');
  withHome(({ core, home }) => {
    const id = core.command('new 甲').text.match(/（(b-[0-9a-f]+)）/)[1];
    core.afterTurn({ session: 's', role: 'user', text: '记住这句话' });
    core.afterTurn({ session: 's', role: 'assistant', text: '记住啦' });
    core.afterTurn({ session: 's', role: 'assistant', text: '   ' });
    const life = openLife(path.join(home, 'beings', id));
    assert.equal(life.turnCount(), 2, '空白不记');
    life.close();
  });
});
