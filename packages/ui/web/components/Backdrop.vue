<script setup>
// 背景：深空渐变（CSS）+ 星点 + 神经连线（canvas）。固定种子，按视口尺寸生成；只在尺寸、主题色、明暗、开关变化时重画，平时不动。
// 亮节点用几个 DOM 点叠在上面，「节点脉动」开着时只给它们加 CSS 透明度动画
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { ui, look } from '../theme/ui.js';

const canvas = ref(null);
const glows = ref([]); // 亮节点 { x, y }
const embed = () => document.documentElement.dataset.embed === '1'; // App 在 setup 里才标上，不能在模块加载时读

/** 固定种子的伪随机数（mulberry32），每次打开图案一样。 */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function draw() {
  const c = canvas.value;
  if (!c) return;
  const w = innerWidth;
  const h = innerHeight;
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = w * dpr;
  c.height = h * dpr;
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const ac = css.getPropertyValue('--ac').trim() || '#4C6AFC';
  const star = look.dark ? '200, 215, 255' : '90, 100, 130';
  const rand = rng(20261109);
  const area = w * h;

  if (ui.backdrop.stars) {
    for (let i = 0, n = Math.round(area / 2600); i < n; i++) {
      const r = rand() < 0.92 ? 0.6 : 1.2;
      g.fillStyle = `rgba(${star}, ${(look.dark ? 0.25 : 0.12) + rand() * (look.dark ? 0.45 : 0.18)})`;
      g.fillRect(rand() * w, rand() * h, r, r);
    }
  }

  const bright = [];
  if (ui.backdrop.lattice) {
    const nodes = Array.from({ length: Math.round(area / (embed() ? 52000 : 26000)) }, () => ({ x: rand() * w, y: rand() * h }));
    g.lineWidth = 1;
    for (const a of nodes) {
      // 每个节点连最近的两个，距离太远不连，图案稀疏、不成网格
      const near = nodes.filter((b) => b !== a).map((b) => [b, Math.hypot(a.x - b.x, a.y - b.y)]).sort((p, q) => p[1] - q[1]).slice(0, 2);
      for (const [b, d] of near) {
        if (d > 240) continue;
        g.strokeStyle = colorAlpha(ac, (look.dark ? 0.22 : 0.16) * (1 - d / 300));
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
      }
    }
    for (const n of nodes) {
      const lit = rand() < 0.1;
      g.fillStyle = colorAlpha(ac, lit ? 0.9 : look.dark ? 0.45 : 0.35);
      g.beginPath();
      g.arc(n.x, n.y, lit ? 2 : 1.3, 0, Math.PI * 2);
      g.fill();
      if (lit) bright.push(n);
    }
  }
  glows.value = bright;
}

/** #RRGGBB 加透明度。 */
function colorAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(3)})`;
}

let frame = 0;
const later = () => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(draw);
};
onMounted(() => {
  draw();
  addEventListener('resize', later);
});
onBeforeUnmount(() => removeEventListener('resize', later));
// 主题色、明暗在根元素上更新后再画，取到的是新颜色
watch(() => [ui.accent, look.dark, ui.backdrop.stars, ui.backdrop.lattice], later);
</script>

<template>
  <div class="backdrop" aria-hidden="true">
    <canvas ref="canvas"></canvas>
    <i v-for="(n, k) in glows" :key="k" :class="['glow', { pulse: ui.backdrop.pulse }]" :style="{ left: `${n.x}px`, top: `${n.y}px`, animationDelay: `${-(k % 7) * 0.9}s` }"></i>
  </div>
</template>
