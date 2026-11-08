<script setup>
import { ref, computed, watch } from 'vue';
import { state, api, load, use, toast, guard, colorOf, ageText, seenText } from '../store.js';
import Avatar from './Avatar.vue';

/* 牌堆：当前个体在最上面；换人时原来那张塞到最后一个可见位置，像把牌插回牌堆底 */
let deck = [];
let timer;
const shown = ref([]);
const shuffling = ref(null);
watch(
  () => state.beings,
  (all) => {
    const ids = all.map((b) => b.id);
    const prev = deck[0];
    const cur = all.find((b) => b.current)?.id;
    deck = [...deck.filter((id) => ids.includes(id)), ...ids.filter((id) => !deck.includes(id))];
    if (cur && deck[0] !== cur) {
      deck = [cur, ...deck.filter((id) => id !== cur && id !== prev)];
      if (prev && ids.includes(prev)) {
        deck.splice(Math.min(deck.length, 3), 0, prev);
        shuffling.value = prev;
        clearTimeout(timer);
        timer = setTimeout(() => (shuffling.value = null), 700); // 动画 650ms；不靠 animationend，后台标签页里它可能不触发
      }
    }
    shown.value = deck.slice(0, 4);
  },
  { immediate: true },
);
// 按固定顺序渲染、只改位置类名：Vue 重排列表会移动 DOM 节点，移动过的节点没有过渡动画
const cards = computed(() => state.beings.filter((b) => shown.value.includes(b.id)));
const pos = (b) => shown.value.indexOf(b.id);

const click = guard(async (b) => (pos(b) === 0 ? (state.tab = 'card') : use(b)));

const newName = ref('');
const create = guard(async () => {
  const name = newName.value.trim();
  if (!name) return toast('先写个名字', true);
  const r = await api('POST', 'new', { name });
  newName.value = '';
  toast(r.text.split('\n')[0]);
  await load();
});

const file = ref(null);
const drag = ref(false);
const importFile = guard(async (f) => {
  if (!f) return;
  toast((await api('POST', `import?name=${encodeURIComponent(f.name)}`, await f.arrayBuffer(), true)).text);
  await load();
});
function picked() {
  const f = file.value.files[0];
  file.value.value = '';
  importFile(f);
}
function dropped(e) {
  drag.value = false;
  importFile(e.dataTransfer.files[0]);
}
</script>

<template>
  <h2>个体</h2>
  <div class="beings">
    <div :class="['stage', { drag }]" aria-label="个体卡片，拖入角色卡文件即可导入" @dragover.prevent="drag = true" @dragleave="drag = false" @drop.prevent="dropped">
      <div v-if="cards.length" class="stack">
        <button
          v-for="b in cards"
          :key="b.id"
          type="button"
          :class="['bcard', `p${pos(b)}`, { shuffle: shuffling === b.id }]"
          :style="{ '--c': colorOf(b) }"
          :aria-label="pos(b) === 0 ? `${b.name}，当前个体，打开角色卡` : `切换到 ${b.name}`"
          @click="click(b)"
        >
          <div class="top">
            <Avatar :being="b" />
            <div>
              <div class="name">{{ b.name }}</div>
              <span class="badge">{{ ageText(b) }}</span>
            </div>
          </div>
          <div class="muted">{{ seenText(b) }}</div>
          <div class="say">{{ b.first_mes || '（还没写开场白）' }}</div>
          <div class="foot">
            <span class="muted">{{ b.lorebook ? `世界书 ${b.lorebook} 条` : '' }}</span>
            <span v-if="b.error" class="badge warn" :title="b.error">角色卡出错</span>
            <span v-else class="badge silver">{{ pos(b) === 0 ? '当前' : '点我切换' }}</span>
          </div>
        </button>
      </div>
      <div v-else class="empty panel">
        <p>还没有个体</p>
        <p class="muted">新建一个，或者把角色卡拖到这里</p>
      </div>
    </div>
    <div class="side">
      <div class="panel">
        <div class="field">
          <label for="newName">新建个体</label>
          <div class="row">
            <input id="newName" v-model="newName" placeholder="名字" maxlength="40" @keydown.enter="create">
            <button class="btn primary" type="button" @click="create">新建</button>
          </div>
        </div>
        <div class="field" style="margin-bottom: 0">
          <label>导入角色卡</label>
          <button class="btn" type="button" @click="file.click()">选择文件</button>
          <input ref="file" type="file" accept=".png,.json,.yaml,.yml" hidden @change="picked">
          <span class="muted">支持本项目的 YAML，以及 SillyTavern 的 JSON / PNG；电脑上也可以直接拖到卡片上。</span>
        </div>
      </div>
      <div class="panel">
        <div class="field" style="margin-bottom: 8px">
          <label>全部个体</label>
          <span class="muted">点一下切换，下一轮生效</span>
        </div>
        <div class="list">
          <button v-for="b in state.beings" :key="b.id" :class="['chip', { on: b.current }]" type="button" @click="guard(use)(b)">
            <Avatar :being="b" size="sm" />
            <span><b>{{ b.name }}</b><br><span class="muted">{{ ageText(b) }} · {{ seenText(b) }}</span></span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
