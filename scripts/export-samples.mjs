// 从 DSH 会话记录里导出用户原话，做记忆提取的样本集（开发计划 M3）。
// 用法：node scripts/export-samples.mjs [会话目录] [输出文件]
// 重跑时按 id 保留已有的标注，只追加新出现的原话。
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { isFromClient, messageText } from 'dsh-chara-soul';

const src = process.argv[2] ?? path.join(homedir(), '.dsh', 'sessions');
const out = process.argv[3] ?? path.join(import.meta.dirname, '..', 'docs', 'samples', '样本.yaml');

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.jsonl(\.zstd)?$/.test(e.name) ? [path.join(d, e.name)] : []));
const read = (f) => (f.endsWith('.zstd') ? zstdDecompressSync(readFileSync(f)) : readFileSync(f)).toString('utf8');

const HEADER = `# 记忆提取样本集。每条是用户在主会话里说的原话，「前文」是紧挨着的上一条模型回复（截断）。
# 标注填在「记」里：一条原话可以记成多条，不该记就留空列表 []。
#   类型：event 事件 · fact 事实 · promise 约定 · preference 喜好 · feeling 感受 · lesson 体会 · rule 规矩 · decision 决定
#   取代：改口时写被取代那条的 id（可省略）
# 例：记: [{类型: preference, 内容: 用户喜欢深夜聊天}]
# 「核对」：你看过并确认无误后改成 true；没核对过的不计入准确率。
`;

const old = new Map((existsSync(out) ? parse(readFileSync(out, 'utf8')) ?? [] : []).map((s) => [s.id, s]));
const samples = [];
for (const f of walk(src)) {
  const events = read(f).trim().split('\n').map((l) => JSON.parse(l));
  if (events[0]?.type !== 'session' || events[0].parentSession) continue; // 只要主会话
  let prev = '';
  for (const e of events) {
    if (e.type === 'assistant/message') {
      const t = messageText(e.data?.message).trim();
      if (t) prev = t;
    } else if (e.type === 'user/message' && isFromClient(e.data)) {
      const id = `${events[0].id.slice(-8)}:${e.seq}`;
      const at = new Date(e.time).toISOString();
      samples.push(old.get(id) ?? { id, 时间: at, 前文: [...prev].slice(0, 120).join(''), 原话: messageText(e.data), 记: [], 核对: false });
      old.delete(id);
    }
  }
}
// 源文件已删掉的旧样本照样保留，标注不丢
samples.push(...old.values());
samples.sort((a, b) => String(a.时间).localeCompare(String(b.时间)));

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, HEADER + stringify(samples, { lineWidth: 0 }));
console.log(`${samples.length} 条 → ${out}`);
