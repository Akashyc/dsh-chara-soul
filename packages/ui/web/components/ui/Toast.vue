<script setup>
// 提示条：内容由 store.toast() 写进 state.toast；出错时红色顶条
import { state } from '../../store.js';
</script>

<template>
  <div :class="['toast', 'plate', { show: state.toast?.show, bad: state.toast?.bad }]" role="status" aria-live="polite">{{ state.toast?.text }}</div>
</template>
