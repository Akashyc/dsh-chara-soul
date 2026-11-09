// 全局状态与接口：页面少、状态简单，用一个 reactive 对象就够，不引入状态库
import { reactive, computed } from 'vue';

const token = new URLSearchParams(location.search).get('t') ?? '';
const base = location.pathname.replace(/\/(index\.html)?$/, '');

export async function api(method, route, body, raw) {
  const r = await fetch(`${base}/api/${route}`, {
    method,
    headers: { 'x-chara-token': token, ...(raw ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `请求失败（${r.status}）`);
  return data;
}

/** 头像或形象图的地址；kind 是 avatar 或 portrait，v 带修改时间让换图后不吃缓存。 */
export const avatarUrl = (b, kind = 'avatar') => `${base}/api/${kind}?id=${encodeURIComponent(b.id)}&t=${encodeURIComponent(token)}&v=${b[kind]}`;

// dirty：当前页有没保存的改动（角色卡、画像页写入），切页签和关页面前据此提醒
export const state = reactive({ beings: [], show: '', tab: 'beings', toast: null, tint: {}, dirty: false });
export const current = computed(() => state.beings.find((b) => b.current));

export async function load() {
  const s = await api('GET', 'state');
  state.beings = s.beings;
  state.show = s.show;
}

let timer;
export function toast(text, bad = false) {
  state.toast = { text, bad, show: true };
  clearTimeout(timer);
  timer = setTimeout(() => (state.toast.show = false), bad ? 6000 : 3200); // 只收起，文字留着让淡出动画完整
}
/** 包一层：出错时弹红色提示，不让异常冒到控制台 */
export const guard = (fn) => async (...a) => {
  try {
    await fn(...a);
  } catch (e) {
    toast(e.message, true);
  }
};

export const STATUS = { dormant: '在休眠', migrated: '已迁出' };

export async function use(b) {
  if (b.current) return;
  if (b.status !== 'awake') {
    if (!confirm(`「${b.name}」${STATUS[b.status]}，${b.status === 'migrated' ? '在这里唤醒等于撤销迁出（另一台电脑上那份会和这里各过各的），' : ''}唤醒并切换过去吗？`)) return;
    await api('POST', 'wake', { id: b.id });
  }
  toast((await api('POST', 'use', { id: b.id })).text);
  await load();
}

/** 休眠：只是不出场，年龄照算；要切换过去得先唤醒 */
export async function sleep(b) {
  if (!confirm(`让「${b.name}」休眠吗？休眠后要先唤醒才能切换过去${b.current ? '；它是当前个体，休眠后下一轮不注入任何内容' : ''}。`)) return;
  toast((await api('POST', 'sleep', { id: b.id })).text);
  await load();
}

/* 每个个体一种光晕色：有头像取头像主色（Avatar 组件算好写进 tint），没有就按名字算一个色相 */
const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.codePointAt(0)) % 360, 7);
export const tintKey = (b) => `${b.id}@${b.avatar}`; // 换了头像就重新取色
export const colorOf = (b) => state.tint[tintKey(b)] ?? `hsl(${hue(b.name)} 85% 62%)`;

export const ageText = (b) => (b.bornDays == null ? '还没醒来' : b.bornDays === 0 ? '今天出生' : `出生 ${b.bornDays} 天`);
export const seenText = (b) => (b.lastSeen == null ? '还没见过面' : b.lastSeen === '刚刚' ? '刚刚见过' : `${b.lastSeen}前见过`);
