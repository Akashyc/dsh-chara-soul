import { mkdirSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const APP = 'dsh-chara-soul';

/** 平台默认的数据目录（架构方案 13.2）。 */
export function defaultHome(env = process.env, platform = process.platform, home = homedir()) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), APP);
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', APP);
  return p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), APP);
}

/** 指向文件：放在默认位置，记着换过之后的数据目录（005 号决定第 6 条）。不能放进数据目录本身，否则换了目录就找不到它。 */
export const pointerFile = (env = process.env, platform = process.platform, home = homedir()) =>
  (platform === 'win32' ? path.win32 : path.posix).join(defaultHome(env, platform, home), 'home.json');

/** 读指向文件：{ home, previous }，没有或读不懂时为 null。 */
export function readPointer(file) {
  try {
    const p = JSON.parse(readFileSync(file, 'utf8'));
    return typeof p?.home === 'string' && p.home ? p : null;
  } catch {
    return null;
  }
}

/** 写指向文件；previous 是换之前的目录，设置页拿来提供「删除旧目录」。 */
export function writePointer(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

/** 数据目录：环境变量 CHARA_SOUL_HOME → 指向文件 → 平台默认位置。 */
export function dataHome(env = process.env, platform = process.platform, home = homedir()) {
  if (env.CHARA_SOUL_HOME) return path.resolve(env.CHARA_SOUL_HOME);
  return readPointer(pointerFile(env, platform, home))?.home ?? defaultHome(env, platform, home);
}

const SYNCED = /(^|[\\/])(OneDrive[^\\/]*|iCloud ?Drive|Mobile Documents|Dropbox|Google Drive|坚果云|百度网盘同步[^\\/]*)([\\/]|$)/i;

/** 位于同步文件夹内时返回提示文字，否则 null。数据库可能被同步损坏。 */
export function syncFolderWarning(dir) {
  return SYNCED.test(dir)
    ? `数据目录 ${dir} 位于同步文件夹内，数据库可能被同步损坏；需要同步时只同步 snapshots/ 下的快照。`
    : null;
}

/** 建好数据目录；macOS 与 Linux 上设为仅本人可读写。 */
export function ensureHome(dir = dataHome()) {
  mkdirSync(dir, { recursive: true });
  if (process.platform !== 'win32') chmodSync(dir, 0o700);
  return dir;
}
