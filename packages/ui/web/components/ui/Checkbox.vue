<script setup>
// 方形勾选框。v-model 是布尔；给了 value 时 v-model 是数组（勾上就放进去），和原生 checkbox 一样
import { computed } from 'vue';

const props = defineProps({ value: { type: [String, Number], default: undefined }, disabled: Boolean });
const model = defineModel({ type: [Boolean, Array], default: false });
const on = computed(() => (Array.isArray(model.value) ? model.value.includes(props.value) : !!model.value));

function toggle() {
  if (props.disabled) return;
  if (Array.isArray(model.value)) model.value = on.value ? model.value.filter((v) => v !== props.value) : [...model.value, props.value];
  else model.value = !model.value;
}
</script>

<template>
  <button type="button" role="checkbox" :aria-checked="on" :disabled="disabled" :class="['check', { on }]" @click="toggle">
    <span class="box" aria-hidden="true"></span>
    <span class="check-label"><slot /></span>
  </button>
</template>
