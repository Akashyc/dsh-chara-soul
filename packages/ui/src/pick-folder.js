// 弹系统的「选择文件夹」对话框。网页拿不到本机完整路径，只能由本机服务端来弹
import { execFile } from 'node:child_process';

const PROMPT = '选一个空文件夹作为新的数据目录';

// Windows：TopMost 的空窗体当父窗口，对话框才不会被 DSH 主窗口压在下面；输出转 UTF-8 免得中文路径乱码
const WIN = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = '${PROMPT}'
$d.ShowNewFolderButton = $true
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
if ($d.ShowDialog($owner) -eq 'OK') { $d.SelectedPath }`;

const COMMANDS = {
  win32: ['powershell.exe', ['-NoProfile', '-STA', '-Command', WIN]],
  darwin: ['osascript', ['-e', `POSIX path of (choose folder with prompt "${PROMPT}")`]],
  linux: ['zenity', ['--file-selection', '--directory', `--title=${PROMPT}`]],
};

/**
 * 弹出选择文件夹对话框，等用户选完。
 * @returns 选中的完整路径；用户取消时为 null
 * @throws 这台机器弹不出对话框时（如 Linux 没装 zenity）
 */
export function pickFolder() {
  const cmd = COMMANDS[process.platform];

  if (!cmd) return Promise.reject(new Error('这台机器弹不出选择框，请手动填路径'));

  return new Promise((resolve, reject) => {
    execFile(cmd[0], cmd[1], { windowsHide: true }, (err, stdout) => {
      // 取消时 osascript、zenity 以非零码退出，PowerShell 输出为空
      if (err?.code === 'ENOENT') return reject(new Error('这台机器弹不出选择框，请手动填路径'));
      if (err) return resolve(null);
      resolve(stdout.trim().replace(/\/$/, '') || null);
    });
  });
}
