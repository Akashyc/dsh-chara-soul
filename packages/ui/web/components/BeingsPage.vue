<script setup>
import { ref, computed, watch } from 'vue';
import { state, api, load, use, sleep, go, STATUS, toast, guard, colorOf, ageText, seenText } from '../store.js';
import Avatar from './Avatar.vue';
import TextField from './ui/TextField.vue';
import FilePicker from './ui/FilePicker.vue';
import RadioGroup from './ui/RadioGroup.vue';

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

const click = guard(async (b) => (pos(b) === 0 ? go('card') : use(b)));

const newName = ref('');
const create = guard(async () => {
  const name = newName.value.trim();
  if (!name) return toast('先写个名字', true);
  const r = await api('POST', 'new', { name });
  newName.value = '';
  toast(r.text.split('\n')[0]);
  await load();
});

const drag = ref(false);
// 灵魂包里的个体或画像本机已有时，先停下来让用户选覆盖、跳过还是新建
const pending = ref(null); // { file, conflicts }
const choice = ref('覆盖');
const CHOICES = [{ value: '覆盖', label: '覆盖本机的' }, { value: '跳过', label: '跳过' }, { value: '新建', label: '新建成新个体' }];
const importFile = guard(async (f, conflict = '') => {
  if (!f) return;
  pending.value = null;
  const r = await api('POST', `import?name=${encodeURIComponent(f.name)}&conflict=${encodeURIComponent(conflict)}`, await f.arrayBuffer(), true);
  if (r.conflicts) {
    pending.value = { file: f, conflicts: r.conflicts };
    return;
  }
  toast(r.text);
  await load();
});
function dropped(e) {
  drag.value = false;
  importFile(e.dataTransfer.files[0]);
}
</script>

<template>
  <h2>个体 <span class="cap">Beings</span></h2>
  <div class="beings">
    <div :class="['stack-area', { drag }]" aria-label="个体卡片，拖入角色卡文件即可导入" @dragover.prevent="drag = true" @dragleave="drag = false" @drop.prevent="dropped">
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
            <span v-else-if="b.status !== 'awake'" class="badge silver">{{ STATUS[b.status] }}</span>
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
            <TextField id="newName" v-model="newName" placeholder="名字" maxlength="40" @keydown.enter="create" />
            <button class="btn primary" type="button" @click="create">新建</button>
          </div>
        </div>
        <div class="field" style="margin-bottom: 0">
          <label>导入角色卡</label>
          <FilePicker accept=".png,.json,.yaml,.yml,.soul" title="把角色卡拖到这里" formats="PNG · JSON · YAML · .soul" @file="importFile" />
          <span class="muted">支持本项目的 YAML、SillyTavern 的 JSON / PNG，以及迁移用的灵魂包 .soul；电脑上也可以直接拖到卡片上。</span>
          <div v-if="pending" class="conflict" role="alert">
            <span>包里的{{ pending.conflicts.join('、') }}本机已有：</span>
            <RadioGroup v-model="choice" :options="CHOICES" label="本机已有时怎么办" />
            <div class="actions">
              <button class="btn primary" type="button" @click="importFile(pending.file, choice)">导入</button>
              <button class="link" type="button" @click="pending = null">取消</button>
            </div>
            <span class="muted">对这次所有重复的都生效；画像只有一份，选新建等于跳过。</span>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="field" style="margin-bottom: 8px">
          <label>全部个体</label>
          <span class="muted">点一下切换，下一轮生效；休眠的点一下先唤醒</span>
        </div>
        <div class="list">
          <div v-for="b in state.beings" :key="b.id" class="being-row">
            <button :class="['being-chip', { on: b.current, asleep: b.status !== 'awake' }]" type="button" @click="guard(use)(b)">
              <Avatar :being="b" size="sm" />
              <span><b>{{ b.name }}</b><br><span class="muted">{{ b.status !== 'awake' ? STATUS[b.status] : `${ageText(b)} · ${seenText(b)}` }}</span></span>
            </button>
            <button v-if="b.status === 'awake'" class="link" type="button" :aria-label="`让 ${b.name} 休眠`" @click="guard(sleep)(b)">休眠</button>
            <button v-if="b.status === 'awake' || b.status === 'dormant'" class="link bad" type="button" :aria-label="`放生 ${b.name}`" @click="state.releasing = b.id; go('release')">放生</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
