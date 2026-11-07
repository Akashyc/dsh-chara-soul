import { mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const APP = 'dsh-chara-soul';

/** 数据目录：CHARA_SOUL_HOME 优先，否则按平台惯例（架构方案 13.2）。 */
export function dataHome(env = process.env, platform = process.platform, home = homedir()) {
  if (env.CHARA_SOUL_HOME) return path.resolve(env.CHARA_SOUL_HOME);
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), APP);
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', APP);
  return p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), APP);
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
