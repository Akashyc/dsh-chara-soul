// 界面外观：主题色、明暗、背景开关。存在服务端设置里（换端口不丢），localStorage 只做缓存，打开页面先用它上色免得闪一下
import { reactive, watch } from 'vue';
import { accentTokens, DEFAULT_ACCENT, isHex } from './accent.js';
import { api } from '../store.js';

const CACHE = 'chara-ui';
const DEFAULTS = { accent: DEFAULT_ACCENT, theme: 'auto', backdrop: { stars: true, lattice: true, pulse: false } };

/** 读缓存；兼容旧版只存明暗的 chara-theme。 */
function cached() {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE) ?? 'null');
    if (v && isHex(v.accent)) return { ...DEFAULTS, ...v, backdrop: { ...DEFAULTS.backdrop, ...v.backdrop } };
  } catch {}
  const old = localStorage.getItem('chara-theme');
  return { ...DEFAULTS, theme: ['auto', 'light', 'dark'].includes(old) ? old : 'auto' };
}

// saved：已保存的；ui：正在显示的（外观页选色时实时预览，取消时退回 saved）
export const saved = reactive(cached());
export const ui = reactive(structuredClone({ ...saved, backdrop: { ...saved.backdrop } }));
// forced：内嵌时宿主推来的明暗，优先于用户设置；dark：最终是不是深色；skin：宿主装了「全鲸封锁」，外观由它接管
export const look = reactive({ forced: '', dark: true, skin: false });

const media = matchMedia('(prefers-color-scheme: dark)');

/** 把明暗和主题色写到根元素上。 */
export function apply() {
  const want = look.forced || (ui.theme === 'auto' ? (media.matches ? 'dark' : 'light') : ui.theme);
  look.dark = want === 'dark';
  const root = document.documentElement;
  root.dataset.theme = want;
  for (const [k, v] of Object.entries(accentTokens(ui.accent, want))) root.style.setProperty(k, v);
}

media.addEventListener('change', apply);
watch(() => [ui.accent, ui.theme, look.forced], apply);
apply();

/** 服务端设置到了：以它为准，更新缓存。 */
export function adopt(server) {
  if (!server) return;
  if (followed) server = { ...server, accent: followed }; // 刚跟着皮肤换过色，晚到的旧设置不能把它盖回去
  Object.assign(saved, server, { backdrop: { ...server.backdrop } });
  revert();
  localStorage.setItem(CACHE, JSON.stringify(saved));
}

/** 放弃预览，回到已保存的。 */
export function revert() {
  Object.assign(ui, saved, { backdrop: { ...saved.backdrop } });
}

/** 保存当前显示的外观。put：(ui) → Promise，由调用方提供接口调用。 */
export async function persist(put) {
  const next = { accent: ui.accent, theme: ui.theme, backdrop: { ...ui.backdrop } };
  await put(next);
  adopt(next);
}

/** 宿主皮肤推来主题色：说明装了皮肤，外观交给它；跟着换色并存进服务端设置。正在预览的其它改动不动。 */
let followed = '';
async function follow(accent) {
  accent = accent.toUpperCase();
  followed = accent;
  look.skin = true;
  document.documentElement.dataset.skin = '1';
  if (accent === saved.accent.toUpperCase()) return;
  const next = { accent, theme: saved.theme, backdrop: { ...saved.backdrop } };
  ui.accent = accent;
  Object.assign(saved, { accent });
  localStorage.setItem(CACHE, JSON.stringify(saved));
  await api('PUT', 'settings', { ui: next }).catch(() => {}); // 存不上只影响下次打开，这次已经变色了
}

// 只认同源消息：跨源页面谁都发得出 postMessage，不能拿它当指令
addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data;
  if (d?.type === 'chara:accent' && isHex(d.accent)) return void follow(d.accent);
  if (!d || d.type !== 'chara:theme') return;
  look.forced = d.theme === 'dark' ? 'dark' : d.theme === 'light' ? 'light' : '';
  // 宿主当前的正文字体（DSH 设置里可改）；没给就用样式表里的默认
  if (typeof d.font === 'string' && d.font.length < 600) document.documentElement.style.setProperty('--font', d.font.trim() || null);
  else document.documentElement.style.removeProperty('--font');
});
