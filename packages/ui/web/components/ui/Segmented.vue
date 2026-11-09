<script setup>
// 分段切换：选中段浅底 + 顶边主题色条。方向键切换
const props = defineProps({ options: { type: Array, required: true }, label: { type: String, required: true } }); // [{ value, label }]
const model = defineModel();

function key(e, i) {
  const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  if (!d) return;
  e.preventDefault();
  const n = (i + d + props.options.length) % props.options.length;
  model.value = props.options[n].value;
  e.currentTarget.parentElement.children[n].focus();
}
</script>

<template>
  <div class="seg" role="radiogroup" :aria-label="label">
    <button
      v-for="(o, i) in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      :tabindex="model === o.value ? 0 : -1"
      :class="{ on: model === o.value }"
      @click="model = o.value"
      @keydown="key($event, i)">{{ o.label }}</button>
  </div>
</template>
