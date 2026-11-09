<script setup>
// 选文件：虚线拖放区 + 「选择文件」按钮；底层仍是隐藏的原生 input，打开系统选择框
import { ref } from 'vue';

defineProps({
  accept: { type: String, required: true },
  title: { type: String, default: '把文件拖到这里' },
  formats: { type: String, default: '' }, // 显示给人看的格式，如 PNG · JSON · YAML · .soul
  button: { type: String, default: '选择文件' },
  disabled: Boolean,
});
const emit = defineEmits(['file']);
const input = ref(null);
const over = ref(false);

function picked() {
  const f = input.value.files[0];
  input.value.value = '';
  if (f) emit('file', f);
}
function dropped(e) {
  over.value = false;
  const f = e.dataTransfer.files[0];
  if (f) emit('file', f);
}
defineExpose({ open: () => input.value.click() });
</script>

<template>
  <div :class="['drop', { over }]" @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="dropped">
    <svg class="drop-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5M4 15v5h16v-5" /></svg>
    <div class="drop-text">
      <span>{{ title }}</span>
      <span v-if="formats" class="muted num">{{ formats }}</span>
    </div>
    <button class="btn" type="button" :disabled="disabled" @click="input.click()">{{ button }}</button>
    <input ref="input" type="file" :accept="accept" hidden @change="picked">
  </div>
</template>
