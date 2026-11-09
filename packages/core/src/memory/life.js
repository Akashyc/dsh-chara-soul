// 一个个体的一生：life.db。原话、少量元数据与分身汇报；记忆点等表在 M3 以新的迁移步骤加入。
import path from 'node:path';
import { openDb, migrate, ftsIndex, search } from '../store/index.js';

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
  // 记忆点（M3）：个体用 chara_remember 自己记、窄规则记「记住……」、用户在界面里手动加；用户可改可删
  (s) => {
    s.db.exec(`CREATE TABLE memories (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      speaker TEXT NOT NULL DEFAULT '用户',
      due INTEGER,
      pinned INTEGER NOT NULL DEFAULT 0,
      origin TEXT NOT NULL CHECK (origin IN ('model', 'rule', 'user')),
      session TEXT,
      created INTEGER NOT NULL,
      touched INTEGER NOT NULL,
      replaced_by INTEGER
    );`);
    ftsIndex(s, 'memories', ['text']);
  },
  // 日记（M4）：一天一篇，day 是个体所在时区的 YYYY-MM-DD；正文里的 [t12] [m3] 指回原话和记忆点。删了可以重写
  `CREATE TABLE diaries (
     day TEXT PRIMARY KEY,
     text TEXT NOT NULL,
     created INTEGER NOT NULL
   );`,
];

const MEMORY_FIELDS = ['kind', 'text', 'speaker', 'due', 'pinned', 'replaced_by'];

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
    /** 按关键词翻原话（M3 之前的简单回想）。返回最相关的 limit 条，按时间先后排。 */
    searchTurns: (query, limit = 8) => search(store, 'turns', 'text', query, limit).sort((a, b) => a.at - b.at),
    turnCount: () => db.prepare('SELECT count(*) n FROM turns').get().n,
    /** 新记一条记忆点，返回 id。 */
    addMemory: ({ kind, text, speaker = '用户', due = null, pinned = 0, origin, session = null, at }) =>
      Number(db.prepare('INSERT INTO memories (kind, text, speaker, due, pinned, origin, session, created, touched) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(kind, text, speaker, due, pinned ? 1 : 0, origin, session, at, at).lastInsertRowid),
    memories: () => db.prepare('SELECT * FROM memories ORDER BY id').all(),
    memory: (id) => db.prepare('SELECT * FROM memories WHERE id = ?').get(id) ?? null,
    /** 只改给出的字段。 */
    updateMemory(id, fields) {
      const keys = MEMORY_FIELDS.filter((k) => k in fields);
      if (keys.length) db.prepare(`UPDATE memories SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
    },
    /** 删掉一条；被它取代的那条恢复成没被取代，免得一起消失。 */
    deleteMemory(id) {
      db.prepare('UPDATE memories SET replaced_by = NULL WHERE replaced_by = ?').run(id);
      db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    },
    /** 想起过：更新最近一次被用到的时刻，鲜明度回升。 */
    touchMemories: (ids, at) => ids.forEach((id) => db.prepare('UPDATE memories SET touched = ? WHERE id = ?').run(at, id)),
    searchMemories: (query, limit = 8) => search(store, 'memories', 'text', query, limit),
    /** [from, to) 之间的原话，按时间排。 */
    turnsBetween: (from, to) => db.prepare('SELECT * FROM turns WHERE at >= ? AND at < ? ORDER BY at, id').all(from, to),
    turnTimes: () => db.prepare('SELECT at FROM turns ORDER BY at').all().map((r) => r.at),
    turnsByIds: (ids) => (ids.length ? db.prepare(`SELECT * FROM turns WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []),
    diaries: () => db.prepare('SELECT * FROM diaries ORDER BY day DESC').all(),
    diary: (day) => db.prepare('SELECT * FROM diaries WHERE day = ?').get(day) ?? null,
    /** 同一天重写时覆盖。 */
    saveDiary: (day, text, at) => db.prepare('INSERT INTO diaries (day, text, created) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET text = excluded.text, created = excluded.created').run(day, text, at),
    deleteDiary: (day) => db.prepare('DELETE FROM diaries WHERE day = ?').run(day),
    close: () => db.close(),
  };
}
