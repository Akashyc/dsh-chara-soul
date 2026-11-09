<script setup>
// 开关：方形滑块，开时主题色
defineProps({ label: { type: String, required: true } });
const model = defineModel({ type: Boolean, default: false });
</script>

<template>
  <button type="button" role="switch" :aria-checked="model" :aria-label="label" :class="['sw', { on: model }]" @click="model = !model"></button>
</template>
