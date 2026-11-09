<script setup>
// 记忆：看个体记下了什么，手动加、改、常驻、删，撤销取代。鲜明度用进度条，不做星图（参考 dsh-memory-blocks，按需取舍）
import { ref, reactive, computed, watchEffect } from 'vue';
import { state, current, api, toast, guard } from '../store.js';
import Avatar from './Avatar.vue';
import Select from './Select.vue';
import DiaryList from './DiaryList.vue';
import TextField from './ui/TextField.vue';
import TextArea from './ui/TextArea.vue';
import DatePicker from './ui/DatePicker.vue';
import Checkbox from './ui/Checkbox.vue';
import Segmented from './ui/Segmented.vue';
import { ask } from './ui/dialog.js';

const mode = ref('points'); // points 记忆点 | diary 日记
const MODES = [{ value: 'points', label: '记忆点' }, { value: 'diary', label: '日记' }];
const ORIGIN = { model: '它自己记的', rule: '你说「记住」时记的', user: '你手动加的', card: '来自角色卡', adopted: '领养前带来的' };

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
  if (id !== viewing.value && dirty.value && !(await ask({ title: '切换个体', text: '有改动还没保存，切换会丢掉这些改动，继续吗？', confirm: '切换' }))) return;
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

async function startEdit(m) {
  if (edit.id != null && edit.id !== m.id && !(await ask({ title: '放弃改动', text: '正在改的那条还没保存，放弃那边的改动吗？', confirm: '放弃' }))) return;
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
  if (!(await ask({ title: `删除 #${m.id}`, text: `删掉 #${m.id}「${m.text}」？删了就找不回来了。${items.value.some((x) => x.replaced_by === m.id) ? '\n被它取代的旧记忆会恢复。' : ''}`, confirm: '删除', danger: true }))) return;
  await api('DELETE', q(m.id));
  if (edit.id === m.id) edit.id = null;
  await reload();
  toast(`#${m.id} 已删除`);
});
</script>

<template>
  <h2>记忆 <span class="cap">Memory</span></h2>
  <div v-if="!state.beings.length" class="panel empty"><p class="muted">先在「个体」页新建或导入一个个体。</p></div>
  <div v-else class="memory">
    <div class="panel side">
      <div class="field">
        <label for="mem-being">看哪个个体</label>
        <Select id="mem-being" :model-value="viewing" :options="beingOptions" @update:model-value="open">
          <template #option="{ option }"><Avatar :being="option.being" size="sm" />{{ option.label }}</template>
        </Select>
      </div>
      <Segmented v-model="mode" :options="MODES" label="看记忆点还是日记" style="display: flex; margin-bottom: 18px" />
      <p v-if="mode === 'diary'" class="muted" style="margin: 0; line-height: 1.7">它每天写一篇日记，每句后面的编号指回当时的原话或记忆点，点开能看。新的一天第一次聊完后，会补写前几天还没写的；也可以在右边选一天现在就写，或者重写某一篇（在 DSH 里输入 /chara dream 也行）。</p>
      <template v-else>
      <b>加一条</b>
      <p class="muted" style="margin-top: 4px">它漏记、记错的，在这里补上或改掉。一条一件事，200 字以内。</p>
      <div class="field">
        <label for="mem-text">内容</label>
        <TextArea id="mem-text" v-model="draft.text" rows="3" maxlength="200" counter placeholder="例如：用户的幸运数字是 6" />
      </div>
      <div class="field">
        <label for="mem-kind">类型</label>
        <Select id="mem-kind" v-model="draft.kind" :options="kindOptions" />
      </div>
      <div class="field">
        <label for="mem-speaker">谁说的</label>
        <TextField id="mem-speaker" v-model="draft.speaker" placeholder="你本人就留空；群里别人说的写昵称" />
      </div>
      <div class="field">
        <label for="mem-due">到期日</label>
        <DatePicker id="mem-due" v-model="draft.due" placeholder="不设到期日" />
        <span class="muted">约定才需要；七天内到期的会排到前面提醒它</span>
      </div>
      <Checkbox v-model="draft.pinned">常驻：一直记得，不会淡忘</Checkbox>
      <div class="actions" style="margin-top: 16px">
        <button class="btn primary" type="button" :disabled="!draft.text.trim()" @click="add">记下</button>
      </div>
      </template>
    </div>

    <DiaryList v-if="mode === 'diary'" :id="viewing" />
    <div v-else class="panel">
      <div class="mem-filter">
        <TextField v-model="filter.q" icon="search" type="search" placeholder="搜内容或说话的人" aria-label="搜索记忆" />
        <div class="kinds" role="group" aria-label="按类型筛选">
          <button type="button" :class="['chip', { on: !filter.kind }]" :aria-pressed="!filter.kind" @click="filter.kind = ''">全部 <span class="num">{{ kindCount('') }}</span></button>
          <template v-for="(label, k) in kinds" :key="k">
            <button v-if="kindCount(k)" type="button" :class="['chip', { on: filter.kind === k }]" :aria-pressed="filter.kind === k" @click="filter.kind = filter.kind === k ? '' : k">{{ label }} <span class="num">{{ kindCount(k) }}</span></button>
          </template>
        </div>
        <Checkbox v-if="replacedCount" v-model="filter.replaced">显示已被取代的（<span class="num">{{ replacedCount }}</span>）</Checkbox>
      </div>

      <p v-if="!items.length" class="muted empty">还什么都没记。它会在聊天里自己记，你说「记住……」时也会记下。</p>
      <p v-else-if="!shown.length" class="muted empty">没有符合条件的记忆。</p>
      <ul class="mem-list">
        <li v-for="m in shown" :key="m.id" :class="['mem', { gone: m.replaced_by != null, pinned: m.pinned }]">
          <template v-if="edit.id === m.id">
            <TextArea v-model="edit.text" rows="3" maxlength="200" counter :aria-label="`#${m.id} 的内容`" />
            <div class="mem-edit">
              <Select v-model="edit.kind" :options="kindOptions" />
              <TextField v-model="edit.speaker" placeholder="谁说的（你本人留空）" aria-label="谁说的" />
              <DatePicker v-model="edit.due" placeholder="到期日" aria-label="到期日" />
            </div>
            <div class="actions">
              <button class="btn primary" type="button" :disabled="!edit.text.trim()" @click="saveEdit">保存</button>
              <button class="btn" type="button" @click="edit.id = null">取消</button>
            </div>
          </template>
          <template v-else>
            <div class="mem-head">
              <span class="tag">{{ kinds[m.kind] ?? m.kind }}</span>
              <span v-if="m.pinned" class="tag ac">常驻</span>
              <span class="muted num">#{{ m.id }} · {{ date(m.created) }} · {{ ORIGIN[m.origin] }}<template v-if="m.speaker !== '用户'"> · {{ m.speaker }} 说的</template><template v-if="m.due"> · {{ m.due }} 到期</template></span>
            </div>
            <div class="mem-text">{{ m.text }}</div>
            <div v-if="m.replaced_by != null" class="muted">
              已被 #{{ m.replaced_by }}「{{ byId.get(m.replaced_by)?.text }}」取代
              <button class="link" type="button" @click="patch(m, { replaced_by: null }, `#${m.id} 恢复了，两条都会记得`)">撤销取代</button>
            </div>
            <div v-else class="mem-foot">
              <div class="meter" :title="m.pinned ? '常驻，不会淡忘' : `鲜明度 ${Math.round(m.vividness * 100)}%：一个月没被想起会淡到约三分之一，再淡就不放进此刻，但回想还能找到`"><i :style="{ width: `${Math.max(3, m.vividness * 100)}%` }"></i></div>
              <span class="num">{{ m.pinned ? '常驻 · 不会淡忘' : `鲜明度 ${Math.round(m.vividness * 100)}%` }}</span>
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
