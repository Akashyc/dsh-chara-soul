<script setup>
// 记忆：看个体记下了什么，手动加、改、常驻、删，撤销取代。鲜明度用进度条，不做星图（参考 dsh-memory-blocks，按需取舍）
import { ref, reactive, computed, watchEffect } from 'vue';
import { state, current, api, toast, guard } from '../store.js';
import Avatar from './Avatar.vue';
import Select from './Select.vue';

const ORIGIN = { model: '它自己记的', rule: '你说「记住」时记的', user: '你手动加的' };

const viewing = ref(current.value?.id ?? state.beings[0]?.id ?? null);
const beingOptions = computed(() => state.beings.map((b) => ({ value: b.id, label: b.name, being: b })));
const kinds = ref({});
const items = ref([]);
const kindOptions = computed(() => Object.entries(kinds.value).map(([value, label]) => ({ value, label })));

const blank = () => ({ kind: 'fact', text: '', speaker: '', due: '', pinned: false });
const draft = reactive(blank()); // 新加的一条
const edit = reactive({ id: null }); // 正在修改的那条，字段平铺在里面
const filter = reactive({ q: '', kind: '', replaced: false });

const dirty = computed(() => !!draft.text.trim() || edit.id != null);
watchEffect(() => (state.dirty = dirty.value)); // 交给 App 在切页签、关页面前提醒

const q = (mid) => `memories?id=${encodeURIComponent(viewing.value)}${mid == null ? '' : `&mid=${mid}`}`;

/**
 * 读入一个个体的记忆；有没保存的改动时先确认。
 * @param id 个体 id
 */
const open = guard(async (id) => {
  if (id !== viewing.value && dirty.value && !confirm('有改动还没保存，切换会丢掉这些改动，继续吗？')) return;
  viewing.value = id;
  edit.id = null;
  Object.assign(draft, blank());
  await reload();
});
async function reload() {
  const r = await api('GET', q());
  kinds.value = r.kinds;
  items.value = r.items;
}
if (viewing.value) open(viewing.value);

const byId = computed(() => new Map(items.value.map((m) => [m.id, m])));
const shown = computed(() => {
  const k = filter.q.trim();
  return items.value
    .filter((m) => (filter.replaced || m.replaced_by == null) && (!filter.kind || m.kind === filter.kind) && (!k || m.text.includes(k) || m.speaker.includes(k)))
    .sort((a, b) => b.pinned - a.pinned || b.vividness - a.vividness || b.id - a.id);
});
const replacedCount = computed(() => items.value.filter((m) => m.replaced_by != null).length);
const kindCount = (k) => items.value.filter((m) => m.replaced_by == null && (!k || m.kind === k)).length;
const date = (t) => new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

const add = guard(async () => {
  const { id } = await api('POST', q(), { ...draft });
  Object.assign(draft, blank());
  await reload();
  toast(`已记下 #${id}，下一轮生效`);
});

function startEdit(m) {
  if (edit.id != null && edit.id !== m.id && !confirm('正在改的那条还没保存，放弃那边的改动吗？')) return;
  Object.assign(edit, { id: m.id, kind: m.kind, text: m.text, speaker: m.speaker === '用户' ? '' : m.speaker, due: m.due });
}
const saveEdit = guard(async () => {
  const { id, ...fields } = edit;
  await api('PUT', q(id), fields);
  edit.id = null;
  await reload();
  toast(`#${id} 已修正，下一轮生效`);
});
const patch = guard(async (m, fields, msg) => {
  await api('PUT', q(m.id), fields);
  await reload();
  toast(msg);
});
const remove = guard(async (m) => {
  if (!confirm(`删掉 #${m.id}「${m.text}」？删了就找不回来了。${items.value.some((x) => x.replaced_by === m.id) ? '\n被它取代的旧记忆会恢复。' : ''}`)) return;
  await api('DELETE', q(m.id));
  if (edit.id === m.id) edit.id = null;
  await reload();
  toast(`#${m.id} 已删除`);
});
</script>

<template>
  <h2>记忆</h2>
  <div v-if="!state.beings.length" class="panel empty"><p class="muted">先在「个体」页新建或导入一个个体。</p></div>
  <div v-else class="memory">
    <div class="panel side">
      <div class="field">
        <label for="mem-being">看哪个个体</label>
        <Select id="mem-being" :model-value="viewing" :options="beingOptions" @update:model-value="open">
          <template #option="{ option }"><Avatar :being="option.being" size="sm" />{{ option.label }}</template>
        </Select>
      </div>
      <b>加一条</b>
      <p class="muted" style="margin-top: 4px">它漏记、记错的，在这里补上或改掉。一条一件事，200 字以内。</p>
      <div class="field">
        <label for="mem-text">内容</label>
        <textarea id="mem-text" v-model="draft.text" rows="3" maxlength="200" placeholder="例如：用户的幸运数字是 6"></textarea>
        <span class="muted">{{ [...draft.text.trim()].length }} / 200 字</span>
      </div>
      <div class="field">
        <label for="mem-kind">类型</label>
        <Select id="mem-kind" v-model="draft.kind" :options="kindOptions" />
      </div>
      <div class="field">
        <label for="mem-speaker">谁说的</label>
        <input id="mem-speaker" v-model="draft.speaker" placeholder="你本人就留空；群里别人说的写昵称">
      </div>
      <div class="field">
        <label for="mem-due">到期日</label>
        <input id="mem-due" v-model="draft.due" type="date">
        <span class="muted">约定才需要；七天内到期的会排到前面提醒它</span>
      </div>
      <label class="check"><input v-model="draft.pinned" type="checkbox"> 常驻：一直记得，不会淡忘</label>
      <div class="actions" style="margin-top: 16px">
        <button class="btn primary" type="button" :disabled="!draft.text.trim()" @click="add">记下</button>
      </div>
    </div>

    <div class="panel">
      <div class="mem-filter">
        <input v-model="filter.q" type="search" placeholder="搜内容或说话的人" aria-label="搜索记忆">
        <div class="kinds" role="group" aria-label="按类型筛选">
          <button type="button" :class="['chip', { on: !filter.kind }]" @click="filter.kind = ''">全部 {{ kindCount('') }}</button>
          <template v-for="(label, k) in kinds" :key="k">
            <button v-if="kindCount(k)" type="button" :class="['chip', { on: filter.kind === k }]" @click="filter.kind = filter.kind === k ? '' : k">{{ label }} {{ kindCount(k) }}</button>
          </template>
        </div>
        <label v-if="replacedCount" class="check"><input v-model="filter.replaced" type="checkbox"> 显示已被取代的（{{ replacedCount }}）</label>
      </div>

      <p v-if="!items.length" class="muted empty">还什么都没记。它会在聊天里自己记，你说「记住……」时也会记下。</p>
      <p v-else-if="!shown.length" class="muted empty">没有符合条件的记忆。</p>
      <ul class="mem-list">
        <li v-for="m in shown" :key="m.id" :class="['mem', { gone: m.replaced_by != null, pinned: m.pinned }]">
          <template v-if="edit.id === m.id">
            <div class="field"><textarea v-model="edit.text" rows="3" maxlength="200" :aria-label="`#${m.id} 的内容`"></textarea></div>
            <div class="mem-edit">
              <Select v-model="edit.kind" :options="kindOptions" />
              <input v-model="edit.speaker" placeholder="谁说的（你本人留空）" aria-label="谁说的">
              <input v-model="edit.due" type="date" aria-label="到期日">
            </div>
            <div class="actions">
              <button class="btn primary" type="button" :disabled="!edit.text.trim()" @click="saveEdit">保存</button>
              <button class="btn" type="button" @click="edit.id = null">取消</button>
            </div>
          </template>
          <template v-else>
            <div class="mem-head">
              <span class="badge" :class="{ silver: !m.pinned }">{{ kinds[m.kind] ?? m.kind }}</span>
              <span class="muted">#{{ m.id }} · {{ date(m.created) }} · {{ ORIGIN[m.origin] }}<template v-if="m.speaker !== '用户'"> · {{ m.speaker }} 说的</template><template v-if="m.due"> · {{ m.due }} 到期</template></span>
            </div>
            <div class="mem-text">{{ m.text }}</div>
            <div v-if="m.replaced_by != null" class="muted">
              已被 #{{ m.replaced_by }}「{{ byId.get(m.replaced_by)?.text }}」取代
              <button class="link" type="button" @click="patch(m, { replaced_by: null }, `#${m.id} 恢复了，两条都会记得`)">撤销取代</button>
            </div>
            <div v-else class="mem-foot">
              <div class="meter" :title="m.pinned ? '常驻，不会淡忘' : `鲜明度 ${Math.round(m.vividness * 100)}%：一个月没被想起会淡到约三分之一，再淡就不放进此刻，但回想还能找到`"><i :style="{ width: `${Math.max(3, m.vividness * 100)}%` }"></i></div>
              <button class="link" type="button" :aria-pressed="m.pinned" @click="patch(m, { pinned: !m.pinned }, m.pinned ? `#${m.id} 不再常驻，会慢慢淡忘` : `#${m.id} 常驻了`)">{{ m.pinned ? '取消常驻' : '常驻' }}</button>
              <button class="link" type="button" @click="startEdit(m)">修改</button>
              <button class="link bad" type="button" @click="remove(m)">删除</button>
            </div>
          </template>
        </li>
      </ul>
    </div>
  </div>
</template>
