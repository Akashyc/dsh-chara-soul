<script setup>
import { ref, computed, watchEffect } from 'vue';
import { state, api, toast, guard } from '../store.js';
import TextArea from './ui/TextArea.vue';

const text = ref('');
const saved = ref(''); // 上次读入或保存时的内容，用来判断有没有没保存的改动
const dirty = computed(() => text.value !== saved.value);
watchEffect(() => (state.dirty = dirty.value)); // 交给 App 在切页签、关页面前提醒

guard(async () => {
  text.value = saved.value = (await api('GET', 'global')).text.replace(/\n$/, '');
})();

const save = guard(async () => {
  await api('PUT', 'global', { text: text.value });
  saved.value = text.value;
  toast('全局提示词已保存，所有个体下一轮生效');
});
</script>

<template>
  <h2>全局提示词 <span class="cap">Global</span></h2>
  <div class="panel" style="max-width: 760px">
    <p class="muted" style="margin-top: 0">对每个个体都生效。排在人设之后、底线之前：能压过人设里的同类要求，但越不过底线。不占本性预算，也不会被截断，写短些更好。</p>
    <div class="field">
      <label for="f-global">内容</label>
      <TextArea id="f-global" v-model="text" rows="12" counter placeholder="例如：回复不要用 Markdown；动作描写放在括号里。" />
    </div>
    <div class="actions save-bar">
      <button class="btn primary" type="button" :disabled="!dirty" @click="save">保存</button>
      <span :class="dirty ? 'dirty' : 'muted'">{{ dirty ? '有改动还没保存' : '已保存' }}</span>
    </div>
  </div>
</template>
