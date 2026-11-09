<script setup>
// 单行输入：普通 / 聚焦 / 出错 / 禁用；可带搜索图标、字数。其余属性（id、placeholder、@keydown.enter…）原样交给 input
import { computed } from 'vue';

defineOptions({ inheritAttrs: false });
const props = defineProps({
  error: { type: String, default: '' },
  icon: { type: String, default: '' }, // 'search'
  maxlength: { type: [Number, String], default: undefined },
  counter: Boolean,
  disabled: Boolean,
  type: { type: String, default: 'text' },
});
const model = defineModel({ type: String, default: '' });
const len = computed(() => [...(model.value ?? '')].length);
</script>

<template>
  <div :class="['tf', { err: error, disabled }]">
    <div class="tf-box">
      <svg v-if="icon === 'search'" class="tf-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>
      <input v-bind="$attrs" v-model="model" :type="type" :maxlength="maxlength" :disabled="disabled" :aria-invalid="!!error || undefined" autocomplete="off">
      <span v-if="counter && maxlength" class="tf-count num">{{ len }} / {{ maxlength }}</span>
    </div>
    <span v-if="error" class="hint bad" role="alert">{{ error }}</span>
  </div>
</template>
