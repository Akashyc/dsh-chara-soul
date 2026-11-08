<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { state, current, api, load, toast, guard } from '../store.js';
import Avatar from './Avatar.vue';
import Fields from './Fields.vue';

const CARD = [
  ['name', '名字', '必填', 'input'],
  ['personality', '性格', '几条最能决定它怎么做事的特点', 8],
  ['speech', '口吻', '怎么说话、自称、口头禅；篇幅要求写在第一句最管用', 5],
  ['appearance', '外貌', '长什么样、标志性的动作；预算紧时最先被截掉', 4],
  ['first_mes', '开场白', '第一次见面说的话，也显示在个体卡片上', 3],
  ['mes_example', '对话示例', '语气参考，暂不注入', 4],
];
const NAMES = { personality: '性格', speech: '口吻', appearance: '外貌' };

const editing = ref(current.value?.id ?? state.beings[0]?.id ?? null);
const being = computed(() => state.beings.find((b) => b.id === editing.value));
const form = reactive({});
const pv = ref(null);

const open = guard(async (id) => {
  editing.value = id;
  const card = await api('GET', `card?id=${encodeURIComponent(id)}`);
  for (const [k] of CARD) form[k] = typeof card[k] === 'string' ? card[k].replace(/\n$/, '') : '';
});
if (editing.value) open(editing.value);

// 改动 300ms 后重算本性预览
let timer;
watch(form, () => {
  clearTimeout(timer);
  timer = setTimeout(guard(async () => (pv.value = await api('POST', 'preview', { ...form }))), 300);
});

const save = guard(async () => {
  await api('PUT', `card?id=${encodeURIComponent(editing.value)}`, { ...form });
  toast('已保存，下一轮生效');
  await load();
});

const file = ref(null);
const changeAvatar = guard(async () => {
  const f = file.value.files[0];
  file.value.value = '';
  if (!f) return;
  await api('PUT', `avatar?id=${encodeURIComponent(editing.value)}`, await f.arrayBuffer(), true);
  await load();
  toast('头像已更换');
});
</script>

<template>
  <h2>角色卡</h2>
  <div v-if="!state.beings.length" class="panel empty"><p class="muted">先在「个体」页新建或导入一个个体。</p></div>
  <div v-else class="editor">
    <div class="panel">
      <div class="field">
        <label>编辑哪个个体</label>
        <div class="pick" role="radiogroup" aria-label="编辑哪个个体">
          <button v-for="b in state.beings" :key="b.id" :class="['chip', { on: b.id === editing }]" type="button" role="radio" :aria-checked="b.id === editing" @click="open(b.id)">
            <Avatar :being="b" size="sm" />{{ b.name }}
          </button>
        </div>
      </div>
      <div class="field">
        <label>头像</label>
        <div class="row" style="gap: 14px; flex-wrap: wrap">
          <Avatar v-if="being" :being="being" />
          <button class="btn" type="button" @click="file.click()">换头像…</button>
          <span class="muted">PNG、JPG、WebP，立即生效</span>
        </div>
        <input ref="file" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="changeAvatar">
      </div>
      <Fields v-model="form" :spec="CARD" :cut="pv?.cut" />
      <div class="actions">
        <button class="btn primary" type="button" @click="save">保存</button>
        <span class="muted">保存后下一轮生效。会按标准格式重写 card.yaml，你自己加的注释会丢掉；世界书条目原样保留。</span>
      </div>
    </div>
    <div class="panel preview">
      <div class="actions" style="justify-content: space-between; margin-bottom: 8px">
        <b>本性预览</b><span v-if="pv" class="muted">{{ pv.length }} / {{ pv.budget }} 字</span>
      </div>
      <div :class="['meter', { over: pv?.cut.length }]"><i :style="{ width: pv ? `${Math.min(100, (pv.length / pv.budget) * 100)}%` : 0 }"></i></div>
      <p v-if="pv" class="muted">
        {{ pv.cut.length ? `超出预算，被截掉的部分：${pv.cut.map((k) => NAMES[k]).join('、')}。底线不会被截。` : '在预算之内，全部内容都会注入。' }}
      </p>
      <pre>{{ pv?.nature }}</pre>
    </div>
  </div>
</template>
