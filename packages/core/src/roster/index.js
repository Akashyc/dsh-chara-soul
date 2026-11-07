// 名册：个体登记与当前选择（架构方案 6.1、6.4）。许可、习得、审计等表到第二期再加。
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../store/index.js';

const STEPS = [
  `CREATE TABLE beings (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT);`,
];

/** 目录名只用系统生成的小写英文 id（架构方案 6.2、13.3）。 */
export const newId = (prefix) => `${prefix}-${randomUUID().replaceAll('-', '').slice(0, 10)}`;

export function openRoster(home, now = Date.now) {
  const store = openDb(path.join(home, 'roster.db'));
  migrate(store, STEPS);
  const db = store.db;
  const getState = (k) => db.prepare('SELECT value FROM state WHERE key = ?').get(k)?.value ?? null;
  const setState = (k, v) => db.prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
  const get = (id) => db.prepare('SELECT * FROM beings WHERE id = ?').get(id) ?? null;

  return {
    store,
    list: () => db.prepare('SELECT * FROM beings ORDER BY created_at').all(),
    get,
    add(name) {
      const id = newId('b');
      db.prepare('INSERT INTO beings (id, name, created_at) VALUES (?, ?, ?)').run(id, name, now());
      return get(id);
    },
    rename: (id, name) => db.prepare('UPDATE beings SET name = ? WHERE id = ?').run(name, id),
    /** 按 id 或名字找；名字重复时要求用 id。 */
    find(key) {
      const byId = get(key);
      if (byId) return byId;
      const rows = db.prepare('SELECT * FROM beings WHERE name = ?').all(key);
      if (rows.length > 1) throw new Error(`有 ${rows.length} 个叫「${key}」的个体，请用 id：${rows.map((r) => r.id).join('、')}`);
      return rows[0] ?? null;
    },
    current: () => (getState('current') ? get(getState('current')) : null),
    setCurrent: (id) => setState('current', id),
    getState,
    setState,
    close: () => db.close(),
  };
}
