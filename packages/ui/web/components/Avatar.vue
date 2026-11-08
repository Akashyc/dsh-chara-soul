<script setup>
import { state, avatarUrl, colorOf, tintKey } from '../store.js';

const props = defineProps({ being: { type: Object, required: true }, size: { type: String, default: '' } });

// 头像加载后缩成 8×8 取平均色，作为这个个体的光晕色
function sample(e) {
  const key = tintKey(props.being);
  if (state.tint[key]) return;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const g = c.getContext('2d');
    g.drawImage(e.target, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) (r += d[i], gr += d[i + 1], b += d[i + 2]);
    state.tint[key] = `rgb(${(r / 64) | 0} ${(gr / 64) | 0} ${(b / 64) | 0})`;
  } catch {}
}
</script>

<template>
  <img v-if="being.avatar" :class="['avatar', size]" alt="" :src="avatarUrl(being)" :style="{ '--c': colorOf(being) }" @load="sample">
  <span v-else :class="['avatar', 'mono', size]" aria-hidden="true" :style="{ '--c': colorOf(being) }">{{ [...being.name][0] ?? '?' }}</span>
</template>
