#!/usr/bin/env node
// chara 命令：与 DSH 里的 /chara 共用同一套核心命令，DSH 不在时也能读写个体数据（验收 10）。
import { createCore } from 'chara-core';

const core = createCore({ host: 'cli' });
try {
  const r = core.command(process.argv.slice(2).join(' '));
  (r.ok ? process.stdout : process.stderr).write(r.text + '\n');
  process.exitCode = r.ok ? 0 : 1;
} finally {
  core.close();
}
