<script setup>
// 背景：深空渐变（CSS）+ 星点 + 神经连线（canvas）。固定种子，布局只在尺寸、主题色、明暗、开关变化时重算；
// 平时以 30 帧慢慢动：少数星点闪烁，节点小幅漂移、连线跟着走，「节点脉动」开着时亮节点呼吸。
// 页面在后台、系统要求减少动态效果时停在静止的一帧。和「全鲸封锁」皮肤的背景是同一套画法
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { ui, look } from '../theme/ui.js';

const canvas = ref(null);
const embed = () => document.documentElement.dataset.embed === '1'; // App 在 setup 里才标上，不能在模块加载时读
const still = matchMedia('(prefers-reduced-motion: reduce)');
const TAU = Math.PI * 2;

/** 固定种子的伪随机数（mulberry32），每次打开图案一样。 */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** #RRGGBB 加透明度。 */
function colorAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(3)})`;
}

let scene = null;
function build() {
  const c = canvas.value;
  if (!c) return;
  const w = innerWidth;
  const h = innerHeight;
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = w * dpr;
  c.height = h * dpr;
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const rand = rng(20261109);
  const area = w * h;
  const stars = !ui.backdrop.stars ? [] : Array.from({ length: Math.round(area / 2600) }, () => ({
    x: rand() * w, y: rand() * h, r: rand() < 0.92 ? 0.6 : 1.2, a: rand(),
    tw: rand() < 0.15 ? 0.5 + rand() * 1.5 : 0, ph: rand() * TAU, // 约 15% 的星点闪烁
  }));
  const nodes = !ui.backdrop.lattice ? [] : Array.from({ length: Math.round(area / (embed() ? 52000 : 26000)) }, () => ({
    x: rand() * w, y: rand() * h, ax: 6 + rand() * 10, ay: 6 + rand() * 10,
    sx: 0.04 + rand() * 0.06, sy: 0.04 + rand() * 0.06, ph: rand() * TAU, lit: rand() < 0.1, px: 0, py: 0,
  }));
  // 每个节点连最近的两个，距离太远不连，图案稀疏、不成网格。按初始位置算一次，漂移时连线跟着端点走
  const links = [];
  for (const a of nodes) {
    for (const [b, d] of nodes.filter((b) => b !== a).map((b) => [b, Math.hypot(a.x - b.x, a.y - b.y)]).sort((p, q) => p[1] - q[1]).slice(0, 2)) {
      if (d <= 240) links.push([a, b, d]);
    }
  }
  const ac = getComputedStyle(document.documentElement).getPropertyValue('--ac').trim() || '#4C6AFC';
  scene = { g, w, h, stars, nodes, links, ac, dark: look.dark, star: look.dark ? '200, 215, 255' : '90, 100, 130' };
}

function paint(t) {
  if (!scene) return;
  const { g, w, h, stars, nodes, links, ac, dark, star } = scene;
  g.clearRect(0, 0, w, h);
  for (const s of stars) {
    let a = (dark ? 0.25 : 0.12) + s.a * (dark ? 0.45 : 0.18);
    if (s.tw) a *= 0.55 + 0.45 * Math.sin(t * s.tw + s.ph);
    g.fillStyle = `rgba(${star}, ${a.toFixed(3)})`;
    g.fillRect(s.x, s.y, s.r, s.r);
  }
  for (const n of nodes) {
    n.px = n.x + n.ax * Math.sin(t * n.sx + n.ph);
    n.py = n.y + n.ay * Math.cos(t * n.sy + n.ph);
  }
  g.lineWidth = 1;
  for (const [a, b, d] of links) {
    g.strokeStyle = colorAlpha(ac, (dark ? 0.22 : 0.16) * (1 - d / 300));
    g.beginPath();
    g.moveTo(a.px, a.py);
    g.lineTo(b.px, b.py);
    g.stroke();
  }
  for (const n of nodes) {
    const breath = n.lit && ui.backdrop.pulse ? 0.6 + 0.4 * Math.sin(t * 1.05 + n.ph) : 1;
    if (n.lit) {
      g.fillStyle = colorAlpha(ac, 0.18 * breath);
      g.beginPath();
      g.arc(n.px, n.py, 8, 0, TAU);
      g.fill();
    }
    g.fillStyle = colorAlpha(ac, n.lit ? 0.9 * breath : dark ? 0.45 : 0.35);
    g.beginPath();
    g.arc(n.px, n.py, n.lit ? 2 : 1.3, 0, TAU);
    g.fill();
  }
}

const moving = () => !still.matches && !document.hidden;
let frame = 0;
let last = 0;
function tick(now) {
  frame = 0;
  if (!moving()) return;
  frame = requestAnimationFrame(tick);
  if (now - last < 33) return; // 30 帧足够，省一半重绘
  last = now;
  paint(now / 1000);
}
const start = () => {
  if (!frame && moving()) frame = requestAnimationFrame(tick);
};
let pending = 0;
const later = () => {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    build();
    paint(performance.now() / 1000);
    start();
  });
};
onMounted(() => {
  build();
  paint(performance.now() / 1000);
  start();
  addEventListener('resize', later);
  document.addEventListener('visibilitychange', start);
  still.addEventListener('change', later);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  cancelAnimationFrame(pending);
  removeEventListener('resize', later);
  document.removeEventListener('visibilitychange', start);
  still.removeEventListener('change', later);
});
// 主题色、明暗在根元素上更新后再画，取到的是新颜色
watch(() => [ui.accent, look.dark, ui.backdrop.stars, ui.backdrop.lattice, ui.backdrop.pulse], later);
</script>

<template>
  <div class="backdrop" aria-hidden="true">
    <canvas ref="canvas"></canvas>
  </div>
</template>
