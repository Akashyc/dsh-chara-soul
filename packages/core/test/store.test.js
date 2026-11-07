import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dataHome, syncFolderWarning, ensureHome, openDb, migrate, ftsIndex, search } from 'chara-core/store';

const STEPS = [
  'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)',
  (s) => ftsIndex(s, 'notes', ['body']),
];

function withDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), '灵魂 测试 '));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('中文加空格路径：建库、迁移、写入、重开后还在', () =>
  withDir((dir) => {
    const file = path.join(dir, '个体 一号', 'life.db');
    let s = openDb(file);
    assert.equal(migrate(s, STEPS), 2);
    s.db.prepare('INSERT INTO notes (body) VALUES (?)').run('用户是写世界卡的');
    s.db.close();

    s = openDb(file);
    assert.equal(migrate(s, STEPS), 2, '重复迁移不出错');
    assert.equal(s.db.prepare('SELECT body FROM notes').get().body, '用户是写世界卡的');
    s.db.close();
  }));

test('库版本比程序新时拒绝打开', () => {
  const s = openDb(':memory:');
  migrate(s, STEPS);
  assert.throws(() => migrate(s, STEPS.slice(0, 1)), /请升级程序/);
});

test('迁移失败整步回滚，版本号不前进', () => {
  const s = openDb(':memory:');
  assert.throws(() => migrate(s, ['CREATE TABLE a (x)', 'CREATE TABLE b (x); CREATE TABLE b (x)']));
  assert.equal(s.db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(s.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name = 'b'").get().n, 0);
});

function seeded(fts) {
  const s = openDb(':memory:');
  if (!fts) s.fts = false;
  migrate(s, STEPS);
  const ins = s.db.prepare('INSERT INTO notes (body) VALUES (?)');
  for (const b of ['用户是写世界卡的', '答应下周三一起看年轮图', '这个仓库只能用 pnpm', '折扣 100% 真的']) ins.run(b);
  return s;
}

for (const fts of [true, false]) {
  test(`检索（FTS ${fts ? '可用' : '不可用，退化为 LIKE'}）`, () => {
    const s = seeded(fts);
    if (fts) assert.ok(s.fts, '本机 SQLite 应带 FTS5 trigram');
    assert.deepEqual(search(s, 'notes', 'body', '世界卡').map((r) => r.body), ['用户是写世界卡的']);
    assert.deepEqual(search(s, 'notes', 'body', '年轮').map((r) => r.body), ['答应下周三一起看年轮图'], '两个字走 LIKE');
    assert.deepEqual(search(s, 'notes', 'body', '100%').map((r) => r.body), ['折扣 100% 真的'], '通配符被转义');
    assert.equal(search(s, 'notes', 'body', '%').length, 1);
    assert.equal(search(s, 'notes', 'body', '"引号"').length, 0, '引号不会弄坏查询');

    s.db.prepare("UPDATE notes SET body = '用户改写剧本了' WHERE body LIKE '%世界卡%'").run();
    assert.equal(search(s, 'notes', 'body', '世界卡').length, 0, '更新后旧内容查不到');
    assert.equal(search(s, 'notes', 'body', '写剧本').length, 1);
    s.db.prepare("DELETE FROM notes WHERE body LIKE '%剧本%'").run();
    assert.equal(search(s, 'notes', 'body', '写剧本').length, 0, '删除后查不到');
  });
}

test('非法表名被拒绝', () => {
  const s = seeded(true);
  assert.throws(() => search(s, 'notes; DROP TABLE notes', 'body', 'x'), /非法标识符/);
});

test('数据目录按平台惯例，CHARA_SOUL_HOME 优先', () => {
  assert.equal(dataHome({ LOCALAPPDATA: 'C:\\Users\\张三\\AppData\\Local' }, 'win32', 'C:\\Users\\张三'), 'C:\\Users\\张三\\AppData\\Local\\dsh-chara-soul');
  assert.equal(dataHome({}, 'darwin', '/Users/z'), '/Users/z/Library/Application Support/dsh-chara-soul');
  assert.equal(dataHome({}, 'linux', '/home/z'), '/home/z/.local/share/dsh-chara-soul');
  assert.equal(dataHome({ XDG_DATA_HOME: '/data' }, 'linux', '/home/z'), '/data/dsh-chara-soul');
  assert.equal(dataHome({ CHARA_SOUL_HOME: path.resolve('x') }, 'linux', '/home/z'), path.resolve('x'));
});

test('同步文件夹提示', () => {
  assert.match(syncFolderWarning('C:\\Users\\z\\OneDrive - 公司\\soul'), /同步文件夹/);
  assert.match(syncFolderWarning('/Users/z/Library/Mobile Documents/com~apple~CloudDocs/soul'), /同步文件夹/);
  assert.match(syncFolderWarning('/home/z/Dropbox/soul'), /同步文件夹/);
  assert.equal(syncFolderWarning('/home/z/.local/share/dsh-chara-soul'), null);
  assert.equal(syncFolderWarning('/home/z/MyDropboxNotes'), null);
});

test('ensureHome 建出目录', () =>
  withDir((dir) => {
    const home = path.join(dir, '数据 目录');
    ensureHome(home);
    assert.ok(existsSync(home));
  }));
