// 时光：一律按现实时间。存储用 UTC 毫秒，展示与按天计算用用户时区（架构方案 10.2、13.6）。

const FIVE_MIN = 5 * 60 * 1000;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** 取整到 5 分钟：同一个 5 分钟内此刻逐字节相同，不反复打断模型缓存。 */
export const floor5 = (ms) => Math.floor(ms / FIVE_MIN) * FIVE_MIN;

/** 用户时区；无效或未给时退回系统时区。 */
export function zone(tz) {
  try {
    if (tz) return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
  } catch {}
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** 某时刻在某时区的日历日期 YYYY-MM-DD。 */
const dateIn = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

/** 按用户时区的日历天数差：跨过几个午夜就是几天，夏令时交给 Intl。 */
export function daysBetween(fromMs, toMs, tz) {
  const [a, b] = [dateIn(fromMs, tz), dateIn(toMs, tz)].map((d) => Date.parse(d + 'T00:00:00Z'));
  return Math.round((b - a) / DAY);
}

/** 「2026年11月8日 星期日 01:55」。 */
export const formatNow = (ms, tz) =>
  new Intl.DateTimeFormat('zh-CN', { timeZone: tz, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);

/** 相隔多久的中文说法。 */
export function relative(ms) {
  if (ms < 5 * MIN) return '刚刚';
  if (ms < HOUR) return `${Math.floor(ms / MIN)} 分钟`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} 小时`;
  const d = Math.floor(ms / DAY);
  if (d < 30) return `${d} 天`;
  if (d < 365) return `${Math.floor(d / 30)} 个月`;
  return `${Math.floor(d / 365)} 年`;
}

/** 两次见面的间隔；系统时间回拨时按 0 计并标记异常，不出现负数。 */
export function gap(prevMs, lastMs) {
  if (prevMs == null || lastMs == null) return { ms: null, rewound: false };
  return lastMs < prevMs ? { ms: 0, rewound: true } : { ms: lastMs - prevMs, rewound: false };
}

/**
 * 此刻里关于时间的几行。now 已取整到 5 分钟。
 * born：出生时刻；prev / last：上一次和这一次用户开口的时刻。
 */
export function timeLines({ now, born, prev, last, tz }) {
  const lines = [`现在是 ${formatNow(now, tz)}（${tz}）。`];
  if (born != null) {
    const age = daysBetween(born, now, tz);
    lines.push(age === 0 ? '你今天刚刚出生。' : `你已经出生 ${age} 天了。`);
  }
  const g = gap(prev, last);
  if (g.rewound) lines.push('（系统时间似乎被往回调过，距上次见面按刚刚算。）');
  else if (g.ms == null) lines.push('这是你们第一次说话。');
  else if (g.ms >= 5 * MIN) lines.push(`距离用户上一次和你说话过去了 ${relative(g.ms)}。`);
  return lines;
}
