#!/usr/bin/env node
// chara 命令：与 DSH 里的 /chara 共用同一套核心命令，DSH 不在时也能读写个体数据（验收 10）。
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createCore } from 'chara-core';
import { createUiHandler } from '../../ui/src/handler.js';

const core = createCore({ host: 'cli' });
const args = process.argv.slice(2);

if (args[0] === 'ui') {
  // 界面：只监听本机，随机令牌；Ctrl+C 退出
  const token = randomBytes(16).toString('hex');
  const server = createServer(createUiHandler(core, { token }));
  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/?t=${token}`;
    console.log(`chara 界面：${url}\n按 Ctrl+C 退出`);
    const [cmd, ...rest] = process.platform === 'win32' ? ['cmd', '/c', 'start', '""', url] : [process.platform === 'darwin' ? 'open' : 'xdg-open', url];
    spawn(cmd, rest, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  });
  process.on('SIGINT', () => (server.close(), core.close(), process.exit(0)));
} else {
  try {
    const r = core.command(args.join(' '));
    (r.ok ? process.stdout : process.stderr).write(r.text + '\n');
    process.exitCode = r.ok ? 0 : 1;
  } finally {
    core.close();
  }
}
