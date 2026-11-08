<script setup>
// 一组表单字段：spec 为 [键, 标签, 提示, 'input' 或行数]；cut 里的字段标红
defineProps({ spec: Array, cut: { type: Array, default: () => [] } });
const model = defineModel({ type: Object, required: true });
</script>

<template>
  <div v-for="[k, label, hint, rows] in spec" :key="k" class="field">
    <label :for="`f-${k}`">{{ label }}</label>
    <input v-if="rows === 'input'" :id="`f-${k}`" v-model="model[k]" :class="{ cut: cut.includes(k) }" autocomplete="off">
    <textarea v-else :id="`f-${k}`" v-model="model[k]" :rows="rows" :class="{ cut: cut.includes(k) }"></textarea>
    <span v-if="hint" class="muted">{{ hint }}</span>
  </div>
</template>
