<script setup>
// 一组表单字段：spec 为 [键, 标签, 提示, 'input' 或行数]；cut 里的字段标红
import TextField from './ui/TextField.vue';
import TextArea from './ui/TextArea.vue';

defineProps({ spec: Array, cut: { type: Array, default: () => [] } });
const model = defineModel({ type: Object, required: true });
</script>

<template>
  <div v-for="[k, label, hint, rows] in spec" :key="k" :class="['field', { cut: cut.includes(k) }]">
    <label :for="`f-${k}`">{{ label }}</label>
    <TextField v-if="rows === 'input'" :id="`f-${k}`" v-model="model[k]" />
    <TextArea v-else :id="`f-${k}`" v-model="model[k]" :rows="rows" />
    <span v-if="hint" class="muted">{{ hint }}</span>
  </div>
</template>
