// 记忆点：类型、鲜明度、此刻里的「记得的事」、只认「记住……」的窄规则。存取在 life.js。
// 判断该记什么交给个体自己（chara_remember），这里不从原话里猜（2026-11-09 用户定，样本里值得记的约一成，规则提取做不准）。

export const KINDS = { fact: '事实', preference: '喜好', promise: '约定', event: '事件', decision: '决定', feeling: '感受', rule: '规矩', lesson: '体会' };
export const MAX_LEN = 200;
const DAY = 86_400_000;
const TAU = 30 * DAY; // 一个月不被想起，鲜明度降到约 0.37
const FADED = 0.1; // 低于它就不再进此刻（约 69 天），回想还能找回

/** 鲜明度 0–1：常驻的不淡忘；其余按最近一次被想起的时间指数衰减。 */
export const vividness = (m, now) => (m.pinned ? 1 : Math.exp(-Math.max(0, now - m.touched) / TAU));

/** 校验用户或个体给的内容：去掉首尾空白，不能空，不能超长（超长要拆开，不悄悄截断）。 */
export function memoryText(text) {
  const t = String(text ?? '').trim();
  if (!t) throw new Error('记忆内容不能为空');
  if ([...t].length > MAX_LEN) throw new Error(`一条记忆最多 ${MAX_LEN} 字，现在 ${[...t].length} 字，请拆成几条`);
  return t;
}

/** 类型代码；也认中文名（模型常填「喜好」而不是 preference）；认不出时当事实。 */
export const kindOf = (k) => (Object.hasOwn(KINDS, k) ? k : (Object.keys(KINDS).find((c) => KINDS[c] === String(k ?? '').trim()) ?? 'fact'));

/**
 * 模型常把类型写进内容开头（「喜好：喜欢喝可乐」），kind 却不填：把开头的类型名摘下来当类型。
 * @returns { kind, text }；kind 已给出有效类型时以它为准，开头的类型名照样摘掉
 */
export function splitKind(text, kind) {
  const m = new RegExp(`^(${Object.values(KINDS).join('|')})\s*[：:]\s*`).exec(text);
  const given = kind != null && String(kind).trim() !== '';
  return m ? { kind: given ? kindOf(kind) : kindOf(m[1]), text: text.slice(m[0].length) } : { kind: kindOf(kind), text };
}

/** QQ 群里转进来的消息带「[昵称 (QQ号)]」前缀，那是群友在说话，不是用户本人。 */
export const groupSpeaker = (text) => /^\[([^\]\n]+?) \([0-9A-F]{8,}\)\]/.exec(String(text))?.[1] ?? null;

/**
 * 窄规则：用户本人明确说「记住 / 记一下 / 别忘了……」时一定记下，补个体漏记。问句、群友的话不算。
 * @returns 要记的内容；不是这类句子时为 null
 */
export function explicitRemember(text) {
  const t = String(text ?? '').trim();
  if (groupSpeaker(t) || /[?？]$/.test(t)) return null;
  const m = /(?:^|[，,。！!\s])(?:请|你)?(?:帮我|给我)?(?:记住|记一下|记好|别忘了|不要忘了)[了啊哦呀，,：:\s]*(.+)$/s.exec(t);
  const body = m?.[1].replace(/[。！!～~\s]+$/, '').trim();
  return body && [...body].length >= 2 && [...body].length <= MAX_LEN ? body : null;
}

/**
 * 某天在 tz 时区的 23:59:59（毫秒）。不用 Date.parse：它按运行程序那台机器的时区算，CI 在 UTC 上会差八小时。
 * @param ymd 日期 YYYY-MM-DD
 * @returns 毫秒；格式不对时为 NaN
 */
export function endOfDay(ymd, tz) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(ymd).trim());
  if (!m) return NaN;
  const guess = Date.UTC(+m[1], m[2] - 1, +m[3], 23, 59, 59);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(guess).map((x) => [x.type, +x.value]));
  return guess - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess); // 减去该时区当时的偏移
}

const md = (t, tz) => new Intl.DateTimeFormat('zh-CN', { timeZone: tz, month: 'numeric', day: 'numeric' }).format(t);

/**
 * 一条记忆在此刻、回想里的写法：#编号 类型（谁说的）：内容（到期）。
 * @param user 用户的名字（画像里的），窄规则记的是用户原话，里面的「我」指用户，不标出来个体会当成自己
 */
export function memoryLine(m, now, tz, user = '用户') {
  const who = m.origin === 'rule' ? `（${user}的原话）` : m.speaker && m.speaker !== '用户' ? `（${m.speaker} 说的）` : '';
  let due = '';
  if (m.due != null) {
    const days = Math.floor((m.due - now) / DAY);
    due = m.due < now ? `（${md(m.due, tz)} 已到期）` : days < 1 ? '（今天到期）' : `（${md(m.due, tz)} 到期，还有 ${days} 天）`;
  }
  return `#${m.id} ${KINDS[m.kind] ?? m.kind}${who}：${m.text}${due}`;
}

/**
 * 此刻里的「记得的事」：没被取代、还没淡忘的。常驻在前，其次是七天内到期或已到期的约定，再按鲜明度。
 * @returns 若干行；一条都没有时为空数组
 */
export function memoryLines(all, now, tz, { max = 20, chars = 800, user } = {}) {
  const urgent = (m) => m.kind === 'promise' && m.due != null && m.due - now < 7 * DAY;
  const rank = (m) => (m.pinned ? 3 : urgent(m) ? 2 : 0) + vividness(m, now);
  const live = all.filter((m) => m.replaced_by == null && (m.pinned || urgent(m) || vividness(m, now) >= FADED)).sort((a, b) => rank(b) - rank(a));
  const out = [];
  let used = 0;
  for (const m of live.slice(0, max)) {
    const line = memoryLine(m, now, tz, user);
    if (used + [...line].length > chars) break;
    out.push(line);
    used += [...line].length;
  }
  return out;
}
