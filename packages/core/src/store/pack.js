// 灵魂包（.soul，004 号决定）：一个 SQLite 文件，pack 表放元数据，files 表放文件原样的字节。迁移、放生共用。
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export const PACK_FORMAT = 1;
const SCHEMA = ['CREATE TABLE pack (key TEXT PRIMARY KEY, value TEXT NOT NULL)', 'CREATE TABLE files (path TEXT PRIMARY KEY, data BLOB NOT NULL)'];

/** 包里只允许出现这些路径：挡住「../」之类写到数据目录外面去的文件名。 */
const ALLOWED = [
  /^beings\/b-[0-9a-f]{10}\/(life\.db|card\.yaml|(avatar|portrait)\.(png|jpg|webp))$/,
  /^profiles\/[\w-]+(\.yaml|\.avatar\.(png|jpg|webp))$/,
  /^global\.md$/,
];
export const allowedPath = (p) => ALLOWED.some((re) => re.test(p));

/**
 * 写一个包。目标已存在时拒绝，不覆盖用户的文件。
 * @param meta 写进 pack 表，值一律 JSON
 * @param files [{ path, data }]，path 用 / 分隔
 */
export function writePack(file, meta, files) {
  if (existsSync(file)) throw new Error(`${file} 已存在，换个位置或先挪走它`);
  for (const f of files) if (!allowedPath(f.path)) throw new Error(`包里不能放 ${f.path}`);
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec('BEGIN');
    for (const s of SCHEMA) db.exec(s);
    const putMeta = db.prepare('INSERT INTO pack (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries({ ...meta, format: PACK_FORMAT })) putMeta.run(k, JSON.stringify(v));
    const putFile = db.prepare('INSERT INTO files (path, data) VALUES (?, ?)');
    for (const f of files) putFile.run(f.path, f.data);
    db.exec('COMMIT');
  } catch (e) {
    db.close();
    rmSync(file, { force: true });
    throw e;
  }
  db.close();
}

/**
 * 读一个包，先核对再信它：库完好、只有本程序建的两张表、版本认得、每个路径都在白名单里。
 * @returns { meta, files: Map<path, Uint8Array> }
 */
export function readPack(file) {
  if (!existsSync(file)) throw new Error(`没有找到 ${file}`);
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    db.exec('PRAGMA trusted_schema = OFF');
  } catch {
    throw new Error('这不是一个灵魂包（打不开）');
  }
  try {
    const ok = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
    if (ok !== 'ok') throw new Error('灵魂包损坏了（完整性校验没通过）');
    const schema = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex_%' ORDER BY name").all();
    const want = SCHEMA.map((sql) => sql.match(/TABLE (\w+)/)[1]).sort();
    if (schema.length !== want.length || schema.some((r, i) => r.type !== 'table' || r.name !== want[i] || !SCHEMA.includes(r.sql))) {
      throw new Error('这不是一个灵魂包（表结构不对）');
    }
    const meta = Object.fromEntries(db.prepare('SELECT key, value FROM pack').all().map((r) => [r.key, JSON.parse(r.value)]));
    if (meta.format !== PACK_FORMAT) throw new Error(`灵魂包格式 ${meta.format} 认不得，请升级程序`);
    const files = new Map();
    for (const r of db.prepare('SELECT path, data FROM files').all()) {
      if (!allowedPath(r.path)) throw new Error(`灵魂包里有不该有的文件：${r.path}`);
      files.set(r.path, r.data);
    }
    return { meta, files };
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error('灵魂包的元数据坏了');
    throw e;
  } finally {
    db.close();
  }
}
