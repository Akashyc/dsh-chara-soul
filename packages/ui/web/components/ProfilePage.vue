<script setup>
import { reactive } from 'vue';
import { api, load, toast, guard } from '../store.js';
import Fields from './Fields.vue';

const PROFILE = [
  ['name', '你的名字', '', 'input'],
  ['call_me', '希望被怎么称呼', '会写进每个个体的本性', 'input'],
  ['relationship', '和个体的关系', '', 3],
  ['taboos', '不想被提起的事', '个体会避开这些话题', 3],
  ['likes', '喜欢的东西', '暂不注入，记忆功能上线后使用', 3],
  ['traits', '性格特点', '暂不注入', 3],
  ['appearance', '外貌', '暂不注入', 3],
];
const form = reactive(Object.fromEntries(PROFILE.map(([k]) => [k, ''])));

guard(async () => {
  const p = await api('GET', 'profile');
  for (const [k] of PROFILE) form[k] = typeof p[k] === 'string' ? p[k].replace(/\n$/, '') : '';
})();

const save = guard(async () => {
  await api('PUT', 'profile', { ...form });
  toast('画像已保存，所有个体下一轮生效');
  await load();
});
</script>

<template>
  <h2>用户画像</h2>
  <div class="panel" style="max-width: 760px">
    <p class="muted" style="margin-top: 0">所有个体共享。写你希望它们知道的自己；名字、称呼、关系、忌讳会进入本性。</p>
    <Fields v-model="form" :spec="PROFILE" />
    <div class="actions"><button class="btn primary" type="button" @click="save">保存</button></div>
  </div>
</template>
