<script setup>
// 滑块：细轨 + 方形滑块，已选段填主题色。拖动、点轨道、方向键 / Home / End 都能调
import { ref, computed } from 'vue';

const props = defineProps({
  min: { type: Number, default: 0 },
  max: { type: Number, default: 1 },
  step: { type: Number, default: 0.01 },
  label: { type: String, required: true },
  disabled: Boolean,
});
const model = defineModel({ type: Number, default: 0 });
const track = ref(null);
const pct = computed(() => ((model.value - props.min) / (props.max - props.min)) * 100);

const clamp = (v) => Math.min(props.max, Math.max(props.min, Math.round(v / props.step) * props.step));
function at(e) {
  const r = track.value.getBoundingClientRect();
  model.value = clamp(props.min + ((e.clientX - r.left) / r.width) * (props.max - props.min));
}
function down(e) {
  if (props.disabled) return;
  e.currentTarget.setPointerCapture(e.pointerId);
  at(e);
}
function key(e) {
  const big = (props.max - props.min) / 10;
  const next = { ArrowRight: model.value + props.step * 10, ArrowUp: model.value + props.step * 10, ArrowLeft: model.value - props.step * 10, ArrowDown: model.value - props.step * 10, PageUp: model.value + big, PageDown: model.value - big, Home: props.min, End: props.max }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  model.value = clamp(next);
}
</script>

<template>
  <div
    ref="track"
    :class="['slider', { disabled }]"
    role="slider"
    :tabindex="disabled ? -1 : 0"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="Math.round(model * 100) / 100"
    :aria-disabled="disabled || undefined"
    @pointerdown="down"
    @pointermove="$event.buttons === 1 && !disabled && at($event)"
    @keydown="key">
    <i class="slider-fill" :style="{ width: `${pct}%` }"></i>
    <i class="slider-thumb" :style="{ left: `${pct}%` }"></i>
  </div>
</template>
