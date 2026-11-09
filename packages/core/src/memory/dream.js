// 入梦：把一天的原话和记忆点交给模型，用个体的口吻写一篇日记，每句标出处（架构方案 10.6、验收 9）。
// 只管拼材料和核对出处；调模型的 complete 由适配器提供，核心不依赖宿主。

const TURN_CHARS = 160; // 每条原话最多给这么多字
const BUDGET = 15000; // 一天的材料总字数上限

const clip = (s, n) => {
  const c = [...String(s).replace(/\s+/g, ' ').trim()];
  return c.length > n ? `${c.slice(0, n).join('')}…` : c.join('');
};

/**
 * 拼入梦的提示。
 * @param turns 这一天的原话（按时间排）
 * @param memories 这一天记下或想起过的记忆点
 * @param who 用户的名字
 * @returns { prompt, tags }：tags 是材料里出现的编号集合，核对日记出处用
 */
export function dreamPrompt({ day, turns, memories, tz, who }) {
  const hm = new Intl.DateTimeFormat('zh-CN', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  let lines = turns.map((t) => `[t${t.id}] ${hm.format(t.at)} ${t.role === 'user' ? who : '你'}：${clip(t.text, TURN_CHARS)}`);
  // shortcut: 超出预算时均匀抽取，聊得特别多的一天会漏掉细节；真不够用时改成先分段摘要再写
  const total = lines.reduce((n, l) => n + [...l].length, 0);
  if (total > BUDGET) {
    const keep = Math.max(1, Math.floor((lines.length * BUDGET) / total));
    lines = Array.from({ length: keep }, (_, i) => lines[Math.floor((i * lines.length) / keep)]);
  }
  const mems = memories.map((m) => `[m${m.id}] ${m.text}`);
  const tags = new Set([...lines, ...mems].map((l) => /^\[([tm]\d+)\]/.exec(l)[1]));
  const prompt = [
    `今天是 ${day}。下面是这一天你和${who}说过的话（t 开头的编号），以及你记下或想起的事（m 开头的编号）。`,
    '',
    '【原话】',
    ...lines,
    ...(mems.length ? ['', '【记得的事】', ...mems] : []),
    '',
    `用你自己的口吻写一篇今天的日记，第一人称，200 到 500 字，可以分段。`,
    '每一句末尾用方括号标出它依据的编号，如 [t12] 或 [t12][m3]。材料里没有的事不要写，没有依据的句子不要写。',
    '只输出日记正文，不要标题和前言。',
  ].join('\n');
  return { prompt, tags };
}

/**
 * 核对日记的出处：每句末尾要有方括号编号，编号必须在材料里。
 * 编号对不上的去掉；一个有效编号都没有的句子整句丢掉（验收 9：每句都有出处）。
 * @param tags dreamPrompt 给出的编号集合
 * @returns 核对后的正文；一句都不剩时为空串
 */
export function checkDiary(text, tags) {
  const out = [];
  // 一句 = 不含方括号的文字 + 一串 [编号] + 句末标点；「我睡了。[t3]」和「我睡了[t3]。」两种写法都认
  for (const m of String(text).matchAll(/([^[\]]*?)((?:\s*\[[^\]\n]*\])+)([。！？!?…~～]*)/g)) {
    const valid = [...m[2].matchAll(/\[([tm]\d+)\]/g)].map((x) => x[1]).filter((t) => tags.has(t));
    if (!m[1].trim() || !valid.length) continue;
    out.push(`${m[1]}${m[3]}${[...new Set(valid)].map((t) => `[${t}]`).join('')}`);
  }
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}
