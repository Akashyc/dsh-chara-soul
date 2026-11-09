<script setup>
// 自制色盘：饱和度/明度方块 + 色相条 + HEX + R/G/B。v-model 是 #RRGGBB
// 内部按 HSV 存，拖到灰色（饱和度 0）时色相不丢
import { reactive, computed, watch } from 'vue';
import { isHex, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb } from '../../theme/accent.js';

const model = defineModel({ type: String, required: true });
const hsv = reactive({ h: 0, s: 0, v: 0 });
const hex = computed(() => rgbToHex(hsvToRgb([hsv.h, hsv.s, hsv.v])));
const rgb = computed(() => hexToRgb(hex.value));
const hexDraft = reactive({ text: '' });

watch(model, (m) => {
  hexDraft.text = m;
  if (!isHex(m) || m.toUpperCase() === hex.value) return;
  const [h, s, v] = rgbToHsv(hexToRgb(m));
  Object.assign(hsv, s ? { h, s, v } : { s, v }); // 灰色没有色相，保留原来的
}, { immediate: true });

const set = (part) => {
  Object.assign(hsv, part);
  model.value = hex.value;
};
const clamp = (x) => Math.min(1, Math.max(0, x));
function drag(e, fn) {
  if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId);
  else if (e.buttons !== 1) return;
  const r = e.currentTarget.getBoundingClientRect();
  fn(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
}
const sv = (e) => drag(e, (x, y) => set({ s: x, v: 1 - y }));
const hue = (e) => drag(e, (x) => set({ h: x * 359.9 }));

function svKey(e) {
  const d = { ArrowRight: ['s', 0.02], ArrowLeft: ['s', -0.02], ArrowUp: ['v', 0.02], ArrowDown: ['v', -0.02] }[e.key];
  if (!d) return;
  e.preventDefault();
  set({ [d[0]]: clamp(hsv[d[0]] + d[1]) });
}
function hueKey(e) {
  const d = { ArrowRight: 2, ArrowUp: 2, ArrowLeft: -2, ArrowDown: -2 }[e.key];
  if (!d) return;
  e.preventDefault();
  set({ h: (hsv.h + d + 360) % 360 });
}

function typedHex(t) {
  hexDraft.text = t;
  const v = t.startsWith('#') ? t : `#${t}`;
  if (isHex(v)) model.value = v.toUpperCase();
}
function typedRgb(i, t) {
  const n = Number(t);
  if (t === '' || !Number.isInteger(n) || n < 0 || n > 255) return;
  const next = [...rgb.value];
  next[i] = n;
  model.value = rgbToHex(next);
}
</script>

<template>
  <div class="cp">
    <div
      class="cp-sv"
      role="slider"
      tabindex="0"
      aria-label="饱和度与明度"
      :aria-valuetext="`饱和度 ${Math.round(hsv.s * 100)}%，明度 ${Math.round(hsv.v * 100)}%`"
      :style="{ '--hue': `hsl(${hsv.h} 100% 50%)` }"
      @pointerdown="sv"
      @pointermove="sv"
      @keydown="svKey">
      <i class="cp-knob" :style="{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }"></i>
    </div>
    <div class="cp-hue" role="slider" tabindex="0" aria-label="色相" aria-valuemin="0" aria-valuemax="360" :aria-valuenow="Math.round(hsv.h)" @pointerdown="hue" @pointermove="hue" @keydown="hueKey">
      <i class="cp-bar" :style="{ left: `${(hsv.h / 360) * 100}%` }"></i>
    </div>
    <div class="cp-fields">
      <label class="lbl" for="cp-hex">色值 HEX</label>
      <div class="tf"><div class="tf-box">
        <i class="cp-chip" :style="{ background: hex }" aria-hidden="true"></i>
        <input id="cp-hex" class="num" :value="hexDraft.text" maxlength="7" spellcheck="false" autocomplete="off" @input="typedHex($event.target.value.trim())">
      </div></div>
      <div class="cp-rgb">
        <div v-for="(c, i) in 'RGB'" :key="c" class="tf"><div class="tf-box">
          <span class="tf-pre" aria-hidden="true">{{ c }}</span>
          <input class="num" :value="rgb[i]" inputmode="numeric" maxlength="3" :aria-label="c" autocomplete="off" @input="typedRgb(i, $event.target.value.trim())">
        </div></div>
      </div>
      <slot />
    </div>
  </div>
</template>
