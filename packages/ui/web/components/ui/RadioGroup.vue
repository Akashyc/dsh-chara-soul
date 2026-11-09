<script setup>
// 单选：菱形，选中内填主题色。方向键在选项间移动（读屏的 radiogroup 写法）
const props = defineProps({ options: { type: Array, required: true }, label: { type: String, default: '' } }); // [{ value, label }]
const model = defineModel();

function key(e, i) {
  const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!d) return;
  e.preventDefault();
  const n = (i + d + props.options.length) % props.options.length;
  model.value = props.options[n].value;
  e.currentTarget.parentElement.children[n].focus();
}
</script>

<template>
  <div class="radios" role="radiogroup" :aria-label="label || undefined">
    <button
      v-for="(o, i) in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      :tabindex="model === o.value || (model == null && i === 0) ? 0 : -1"
      :class="['radio', { on: model === o.value }]"
      @click="model = o.value"
      @keydown="key($event, i)">
      <span class="dia" aria-hidden="true"></span>{{ o.label }}
    </button>
  </div>
</template>
