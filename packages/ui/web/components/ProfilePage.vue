<script setup>
import { reactive, ref, computed, watchEffect } from 'vue';
import { state, api, load, toast, guard } from '../store.js';
import Fields from './Fields.vue';

const PROFILE = [
  ['name', '你的名字', '', 'input'],
  ['call_me', '希望被怎么称呼', '会写进每个个体的本性', 'input'],
  ['traits', '性格特点', '暂不注入', 3],
  ['appearance', '外貌', '暂不注入', 3],
  ['taboos', '不想被提起的事', '个体会避开这些话题', 3],
  ['likes', '喜欢的东西', '暂不注入，记忆功能上线后使用', 3],
];
const form = reactive(Object.fromEntries(PROFILE.map(([k]) => [k, ''])));
const saved = ref(JSON.stringify(form)); // 上次读入或保存时的快照，用来判断有没有没保存的改动
const dirty = computed(() => JSON.stringify(form) !== saved.value);
watchEffect(() => (state.dirty = dirty.value)); // 交给 App 在切页签、关页面前提醒

guard(async () => {
  const p = await api('GET', 'profile');
  for (const [k] of PROFILE) form[k] = typeof p[k] === 'string' ? p[k].replace(/\n$/, '') : '';
  saved.value = JSON.stringify(form);
})();

const save = guard(async () => {
  await api('PUT', 'profile', { ...form });
  saved.value = JSON.stringify(form);
  toast('画像已保存，所有个体下一轮生效');
  await load();
});
</script>

<template>
  <h2>用户画像</h2>
  <div class="panel" style="max-width: 760px">
    <p class="muted" style="margin-top: 0">所有个体共享。写你希望它们知道的自己；名字、称呼、忌讳会进入本性；和每个个体的关系写在各自的角色卡里。</p>
    <Fields v-model="form" :spec="PROFILE" />

    <!-- 保存条 -->
    <div class="actions save-bar">
      <button class="btn primary" type="button" :disabled="!dirty" @click="save">保存</button>
      <span :class="dirty ? 'dirty' : 'muted'">{{ dirty ? '有改动还没保存' : '已保存' }}</span>
    </div>
  </div>
</template>
