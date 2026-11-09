<script setup>
// 日记：一天一篇，正文里的 [t12] [m3] 是出处，点开看当时的原话或记忆点（验收 9）。写日记要调模型，只在 DSH 里能写
import { ref, reactive, watch } from 'vue';
import { api, toast, guard } from '../store.js';

const props = defineProps({ id: { type: String, required: true } });
const list = ref([]);
const opened = reactive({}); // day → 点开的出处编号，按点击先后
const day = ref(new Date().toLocaleDateString('en-CA')); // 本机今天，YYYY-MM-DD
const busy = ref(''); // 正在写哪一天；写一篇要等模型几十秒

const q = (day) => `diaries?id=${encodeURIComponent(props.id)}${day ? `&day=${encodeURIComponent(day)}` : ''}`;
const load = guard(async () => {
  list.value = await api('GET', q());
});
watch(() => props.id, load, { immediate: true });

/** 正文切成段落，段落里的出处编号单独拿出来做成按钮。 */
const paragraphs = (text) => text.split(/\n{2,}/).map((p) => p.split(/(\[[tm]\d+\])/).filter(Boolean));
const tagOf = (part) => /^\[([tm]\d+)\]$/.exec(part)?.[1];

/** 点出处：没开就加到这篇日记下面的出处列表，开着就收起。 */
function toggle(day, tag) {
  const cur = opened[day] ?? [];
  opened[day] = cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag];
}

/**
 * 写某一天的日记；那天已经有了就覆盖。
 * @param d 日期 YYYY-MM-DD
 */
const write = guard(async (d) => {
  if (list.value.some((x) => x.day === d) && !confirm(`${d} 已经有日记了，重写会覆盖掉现在这篇，继续吗？`)) return;
  busy.value = d;
  try {
    await api('POST', q(d));
    await load();
    toast(`${d} 的日记写好了`);
  } finally {
    busy.value = '';
  }
});

const remove = guard(async (d) => {
  if (!confirm(`删掉 ${d.day} 的日记？删了还能重写，但重写的内容会不一样。`)) return;
  await api('DELETE', q(d.day));
  delete opened[d.day];
  await load();
  toast(`${d.day} 的日记已删除`);
});
</script>

<template>
  <div class="panel">
    <div class="actions" style="margin-bottom: 18px">
      <input v-model="day" type="date" aria-label="写哪一天的日记" style="width: 180px">
      <button class="btn primary" type="button" :disabled="!day || !!busy" @click="write(day)">{{ busy ? `正在写 ${busy} 的…` : '写这天的日记' }}</button>
      <span class="muted">要调一次模型，等几十秒</span>
    </div>
    <p v-if="!list.length" class="muted empty">还没有日记。新的一天第一次聊完后，它会补写前几天的；也可以在上面选一天，现在就写。</p>
    <article v-for="d in list" :key="d.day" class="diary">
      <div class="mem-head">
        <span class="badge">{{ d.day }}</span>
        <span class="muted" style="flex: 1">写于 {{ new Date(d.created).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</span>
        <button class="link" type="button" :disabled="!!busy" @click="write(d.day)">{{ busy === d.day ? '正在重写…' : '重写' }}</button>
        <button class="link bad" type="button" @click="remove(d)">删除</button>
      </div>
      <p v-for="(para, i) in paragraphs(d.text)" :key="i" class="diary-text">
        <template v-for="(part, j) in para" :key="j">
          <button v-if="tagOf(part)" type="button" :class="['src', { on: opened[d.day]?.includes(tagOf(part)) }]" :title="d.sources[tagOf(part)] ?? '找不到这条出处'" :aria-pressed="!!opened[d.day]?.includes(tagOf(part))" @click="toggle(d.day, tagOf(part))">{{ tagOf(part) }}</button>
          <template v-else>{{ part }}</template>
        </template>
      </p>
      <ul v-if="opened[d.day]?.length" class="diary-src">
        <li v-for="t in opened[d.day]" :key="t"><b>{{ t }}</b> {{ d.sources[t] ?? '找不到这条出处（原话或记忆点已被删除）' }}</li>
      </ul>
    </article>
  </div>
</template>
