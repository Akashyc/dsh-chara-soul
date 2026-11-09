<script setup>
// 多行输入：样式与 TextField 一致；有上限时显示字数
import { computed } from 'vue';

defineOptions({ inheritAttrs: false });
const props = defineProps({
  error: { type: String, default: '' },
  maxlength: { type: [Number, String], default: undefined },
  counter: Boolean,
  rows: { type: [Number, String], default: 3 },
  disabled: Boolean,
});
const model = defineModel({ type: String, default: '' });
const len = computed(() => [...(model.value ?? '').trim()].length);
</script>

<template>
  <div :class="['tf', 'ta', { err: error, disabled }]">
    <div class="tf-box">
      <textarea v-bind="$attrs" v-model="model" :rows="rows" :maxlength="maxlength" :disabled="disabled" :aria-invalid="!!error || undefined"></textarea>
    </div>
    <span v-if="error" class="hint bad" role="alert">{{ error }}</span>
    <span v-if="counter" class="tf-count num">{{ len }}{{ maxlength ? ` / ${maxlength}` : '' }} 字</span>
  </div>
</template>
