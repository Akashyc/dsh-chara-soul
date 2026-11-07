import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/** 探测 FTS5 + trigram 是否可用；某些平台的 SQLite 没编进 FTS5。 */
function probeFts(db) {
  try {
    db.exec("CREATE VIRTUAL TABLE temp.__fts_probe USING fts5(x, tokenize='trigram'); DROP TABLE temp.__fts_probe;");
    return true;
  } catch {
    return false;
  }
}

/** 打开（不存在则新建）一个库文件。返回 { db, fts }，所有访问经这里，便于将来换驱动。 */
export function openDb(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return { db, fts: probeFts(db) };
}

/** 在一个事务里执行 fn；出错回滚，写到一半断电也不会留下半截数据。 */
export function tx(store, fn) {
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    store.db.exec('COMMIT');
    return out;
  } catch (e) {
    store.db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * 按 PRAGMA user_version 依次执行尚未执行的迁移。
 * steps[i] 是 SQL 字符串或 (store) => void，执行后 user_version = i + 1。
 */
export function migrate(store, steps) {
  const from = store.db.prepare('PRAGMA user_version').get().user_version;
  if (from > steps.length) throw new Error(`库版本 ${from} 比程序认识的 ${steps.length} 新，请升级程序`);
  for (let v = from; v < steps.length; v++) {
    tx(store, () => {
      const step = steps[v];
      typeof step === 'function' ? step(store) : store.db.exec(step);
      store.db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return steps.length;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (name) => {
  if (!IDENT.test(name)) throw new Error(`非法标识符：${name}`);
  return name;
};

/** 给 table 的若干列建 trigram 全文索引（外部内容表 + 触发器同步）。FTS 不可用时什么都不做。 */
export function ftsIndex(store, table, columns) {
  if (!store.fts) return;
  const t = ident(table);
  const cols = columns.map(ident).join(', ');
  const vals = (prefix) => columns.map((c) => `${prefix}.${c}`).join(', ');
  store.db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${t}_fts USING fts5(${cols}, content='${t}', content_rowid='rowid', tokenize='trigram');
    INSERT INTO ${t}_fts(${t}_fts) VALUES ('rebuild');
    CREATE TRIGGER IF NOT EXISTS ${t}_fts_ai AFTER INSERT ON ${t} BEGIN
      INSERT INTO ${t}_fts(rowid, ${cols}) VALUES (new.rowid, ${vals('new')});
    END;
    CREATE TRIGGER IF NOT EXISTS ${t}_fts_ad AFTER DELETE ON ${t} BEGIN
      INSERT INTO ${t}_fts(${t}_fts, rowid, ${cols}) VALUES ('delete', old.rowid, ${vals('old')});
    END;
    CREATE TRIGGER IF NOT EXISTS ${t}_fts_au AFTER UPDATE ON ${t} BEGIN
      INSERT INTO ${t}_fts(${t}_fts, rowid, ${cols}) VALUES ('delete', old.rowid, ${vals('old')});
      INSERT INTO ${t}_fts(rowid, ${cols}) VALUES (new.rowid, ${vals('new')});
    END;`);
}

/**
 * 在 table.column 里查包含 query 的行（返回整行）。
 * 三个字及以上且有 FTS 时走 trigram 索引；否则退化为 LIKE。
 * shortcut: 不足三个字的词走 LIKE 全表扫描，单个库记忆点上了十万条后再按架构方案 11.1 另建短词索引。
 */
export function search(store, table, column, query, limit = 20) {
  const t = ident(table);
  const c = ident(column);
  if (store.fts && [...query].length >= 3) {
    return store.db
      .prepare(`SELECT ${t}.* FROM ${t}_fts JOIN ${t} ON ${t}.rowid = ${t}_fts.rowid WHERE ${t}_fts.${c} MATCH ? ORDER BY rank LIMIT ?`)
      .all(`"${query.replaceAll('"', '""')}"`, limit);
  }
  const like = `%${query.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  return store.db.prepare(`SELECT * FROM ${t} WHERE ${c} LIKE ? ESCAPE '\\' ORDER BY rowid DESC LIMIT ?`).all(like, limit);
}
