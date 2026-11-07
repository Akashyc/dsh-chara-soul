// 一个个体的一生：life.db。原话、少量元数据与分身汇报；记忆点等表在 M3 以新的迁移步骤加入。
import path from 'node:path';
import { openDb, migrate, ftsIndex } from '../store/index.js';

const STEPS = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
   CREATE TABLE turns (
     id INTEGER PRIMARY KEY,
     session TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
     text TEXT NOT NULL,
     at INTEGER NOT NULL,
     host TEXT NOT NULL
   );`,
  (s) => ftsIndex(s, 'turns', ['text']),
  // 分身：id 是宿主的子会话 id；M3 再从汇报里提取事件、决定与成果
  `CREATE TABLE envoys (
     id TEXT PRIMARY KEY,
     session TEXT NOT NULL,
     task TEXT NOT NULL,
     report TEXT NOT NULL,
     at INTEGER NOT NULL,
     host TEXT NOT NULL
   );`,
];

export function openLife(dir) {
  const store = openDb(path.join(dir, 'life.db'));
  migrate(store, STEPS);
  const db = store.db;
  const meta = (k) => {
    const v = db.prepare('SELECT value FROM meta WHERE key = ?').get(k)?.value;
    return v === undefined ? null : JSON.parse(v);
  };
  const setMeta = (k, v) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(v));
  return {
    store,
    meta,
    setMeta,
    /** 原话只追加、不修改（架构方案 2.3）。 */
    appendTurn: ({ session, role, text, at, host }) =>
      db.prepare('INSERT INTO turns (session, role, text, at, host) VALUES (?, ?, ?, ?, ?)').run(session, role, text, at, host),
    /** 同一个分身重复结算时保留最新的汇报。 */
    appendEnvoy: ({ id, session, task, report, at, host }) =>
      db.prepare('INSERT INTO envoys (id, session, task, report, at, host) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET report = excluded.report, at = excluded.at').run(id, session, task, report, at, host),
    turnCount: () => db.prepare('SELECT count(*) n FROM turns').get().n,
    close: () => db.close(),
  };
}
