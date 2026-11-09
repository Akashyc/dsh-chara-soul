// 主题色：用户只给一个颜色，其余配色由它推算（封锁风重构交接 4.2）。不引入第三方库。

export const DEFAULT_ACCENT = '#4C6AFC';
export const PRESETS = [
  ['深海蓝', '#4C6AFC'],
  ['封锁橙', '#FF7A1A'],
  ['信号青', '#2EC4B6'],
  ['星云紫', '#8B5CF6'],
  ['樱粉', '#F05A8C'],
  ['皇冠金', '#E3B341'],
  ['极光绿', '#3DBA7E'],
];
// 面板底色：对比度都对着它算。深色取 --bg1，浅色取浅色主题的面板底
export const SURFACE = { dark: '#0B1022', light: '#EEF1F8' };
const ON_DARK = '#0B1022';

export const isHex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);

export function hexToRgb(hex) {
  if (!isHex(hex)) throw new Error(`颜色要写成 #RRGGBB：${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (rgb) => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

const toLin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG 相对亮度与对比度。 */
export const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map(toLin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** sRGB ↔ OKLCH（Björn Ottosson 的 OKLab）。 */
export function toOklch(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}
function oklchToRgb(L, C, H) {
  const A = C * Math.cos(H);
  const B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
/** 超出 sRGB 时降彩度，保住色相和明度。 */
function fromOklch(L, C, H) {
  let c = C;
  for (let i = 0; i < 40; i++, c *= 0.92) {
    const lin = oklchToRgb(L, c, H);
    if (lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) return rgbToHex(lin.map((v) => toSrgb(Math.min(1, Math.max(0, v)))));
  }
  return rgbToHex(oklchToRgb(L, 0, H).map((v) => toSrgb(Math.min(1, Math.max(0, v)))));
}

// 亮色文字的起点明度：默认色这样推出 #9DAEFF 左右（交接里的实测值）；不够 4.5:1 时继续往亮调
const TEXT_L = { dark: 0.78, light: 0.45 };

/**
 * 深底（或浅底）上的主题色文字：保持色相与彩度，调明度到对比度 ≥ 4.5:1。
 * @param mode 'dark' | 'light'
 */
export function accentText(hex, mode = 'dark') {
  const [L0, C, H] = toOklch(hex);
  const bg = SURFACE[mode];
  const dir = mode === 'dark' ? 1 : -1;
  let L = mode === 'dark' ? Math.max(L0, TEXT_L.dark) : Math.min(L0, TEXT_L.light);
  let out = fromOklch(L, C, H);
  while (contrast(out, bg) < 4.5 && L > 0 && L < 1) {
    L += dir * 0.01;
    out = fromOklch(L, C, H);
  }
  return out;
}

/** 主按钮上的字：白或深，取对比度高的。 */
export const onAccent = (hex) => (contrast(hex, '#FFFFFF') >= contrast(hex, ON_DARK) ? '#FFFFFF' : ON_DARK);

const rgba = (hex, a) => `rgba(${hexToRgb(hex).join(', ')}, ${a})`;

/** 全部派生变量。 */
export function accentTokens(hex, mode = 'dark') {
  return {
    '--ac': hex.toUpperCase(),
    '--ac-soft': rgba(hex, 0.16),
    '--ac-line': rgba(hex, 0.75),
    '--ac-tx': accentText(hex, mode),
    '--on-ac': onAccent(hex),
  };
}

/** 主题色本身和面板底的对比度；< 3 时设置页提示不够清楚。 */
export const accentContrast = (hex, mode = 'dark') => contrast(hex, SURFACE[mode]);

/** 色盘用的 HSV（h 0–360，s、v 0–1）与 RGB 互转。 */
export function rgbToHsv([r, g, b]) {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max / 255];
}
export function hsvToRgb([h, s, v]) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return 255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}
