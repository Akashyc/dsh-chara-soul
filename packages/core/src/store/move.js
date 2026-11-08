// 搬数据目录（005 号决定第 6 条）：只复制、核对，不删旧目录。调用前必须先关掉所有库。
import { existsSync, readdirSync, statSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const POINTER = 'home.json'; // 默认位置下的指向文件，不算数据

/** 目录下所有文件的相对路径与大小，用来核对复制完整。 */
function inventory(dir, rel = '') {
  return readdirSync(path.join(dir, rel), { withFileTypes: true })
    .filter((e) => !(rel === '' && e.name === POINTER))
    .flatMap((e) => {
      const r = path.join(rel, e.name);
      return e.isDirectory() ? inventory(dir, r) : [[r, statSync(path.join(dir, r)).size]];
    });
}

/** 数据目录里要搬的顶层项。 */
export const homeEntries = (dir) => readdirSync(dir).filter((n) => n !== POINTER);

/** 目标能不能用：不存在，或里面除了指向文件什么都没有。 */
export const isEmptyTarget = (dir) => !existsSync(dir) || homeEntries(dir).length === 0;

/**
 * 把 from 的数据复制到 to，并核对文件清单、大小和每个库的 integrity_check。
 * 任何一步失败都删掉这次复制出来的东西再抛错，旧目录原样不动。
 * @param from 旧数据目录，库必须已全部关闭
 * @param to 新数据目录，必须为空或不存在
 */
export function copyHome(from, to) {
  if (!isEmptyTarget(to)) throw new Error(`目标目录 ${to} 里已有东西；不合并数据，请选一个空目录`);
  const created = !existsSync(to);
  const names = homeEntries(from);

  try {
    mkdirSync(to, { recursive: true });
    for (const n of names) cpSync(path.join(from, n), path.join(to, n), { recursive: true, errorOnExist: true, force: false });

    const want = JSON.stringify(inventory(from).sort());
    if (JSON.stringify(inventory(to).sort()) !== want) throw new Error('复制后文件数量或大小对不上');
    for (const [rel] of inventory(to).filter(([r]) => r.endsWith('.db'))) {
      const db = new DatabaseSync(path.join(to, rel), { readOnly: true });
      try {
        const r = db.prepare('PRAGMA integrity_check').get();
        if (Object.values(r)[0] !== 'ok') throw new Error(`${rel} 校验没通过`);
      } finally {
        db.close();
      }
    }
  } catch (e) {
    if (created) rmSync(to, { recursive: true, force: true });
    else for (const n of names) rmSync(path.join(to, n), { recursive: true, force: true });
    throw e;
  }
}
