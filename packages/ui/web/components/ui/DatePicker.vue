<script setup>
// 日期：自制日历，今天描边、选中填色、可清空。值与原生 date 输入一样是 'YYYY-MM-DD'，空为 ''
// 键盘：方向键按天/周移动，PageUp/PageDown 换月，回车选中，Esc 收起并回到按钮
import { ref, computed, nextTick, useId } from 'vue';

defineOptions({ inheritAttrs: false });
defineProps({ placeholder: { type: String, default: '选择日期' } });
const model = defineModel({ type: String, default: '' });

const gridId = useId();
const open = ref(false);
const cursor = ref(new Date()); // 键盘高亮的那天；所在月份就是正在看的月份
const root = ref(null);
const trigger = ref(null);
const grid = ref(null);

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = fmt(new Date());
const parse = (s) => {
  const [y, m, d] = (s ?? '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

// 周一开头的 6 行，补上前后月的日子，换月时网格高度不跳
const days = computed(() => {
  const c = cursor.value;
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { key: fmt(d), date: d, out: d.getMonth() !== c.getMonth() };
  });
});
const title = computed(() => `${cursor.value.getFullYear()} · ${pad(cursor.value.getMonth() + 1)}`);

async function focusCursor() {
  await nextTick();
  grid.value?.querySelector(`[data-day="${fmt(cursor.value)}"]`)?.focus();
}
function show() {
  cursor.value = parse(model.value) ?? new Date();
  open.value = true;
  focusCursor();
}
function close(back = true) {
  open.value = false;
  if (back) trigger.value?.focus();
}
function pick(d) {
  model.value = fmt(d);
  close();
}
function clear() {
  model.value = '';
  close();
}
function shift(days, months = 0) {
  const d = new Date(cursor.value);
  if (months) d.setMonth(d.getMonth() + months, Math.min(d.getDate(), 28));
  d.setDate(d.getDate() + days);
  cursor.value = d;
  focusCursor();
}
function key(e) {
  const k = { ArrowRight: [1], ArrowLeft: [-1], ArrowDown: [7], ArrowUp: [-7], PageDown: [0, 1], PageUp: [0, -1] }[e.key];
  if (k) {
    e.preventDefault();
    shift(...k);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }
}
// 焦点离开整个组件就收起，不抢焦点
function out(e) {
  if (!root.value?.contains(e.relatedTarget)) close(false);
}
</script>

<template>
  <div ref="root" :class="['date', { open }]" @focusout="out">
    <button ref="trigger" v-bind="$attrs" class="date-trigger" type="button" aria-haspopup="dialog" :aria-expanded="open" @click="open ? close() : show()">
      <span :class="['num', { muted: !model }]">{{ model || placeholder }}</span>
      <svg class="date-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></svg>
    </button>
    <div v-if="open" class="date-pop" role="dialog" :aria-label="placeholder" @keydown="key">
      <div class="date-head">
        <button class="icon-btn" type="button" aria-label="上个月" @click="shift(0, -1)">‹</button>
        <span class="num" aria-live="polite">{{ title }}</span>
        <button class="icon-btn" type="button" aria-label="下个月" @click="shift(0, 1)">›</button>
      </div>
      <div class="date-week" aria-hidden="true"><span v-for="w in '一二三四五六日'" :key="w">{{ w }}</span></div>
      <div :id="gridId" ref="grid" class="date-grid" role="grid">
        <button
          v-for="d in days"
          :key="d.key"
          type="button"
          role="gridcell"
          :data-day="d.key"
          :tabindex="d.key === fmt(cursor) ? 0 : -1"
          :aria-selected="d.key === model"
          :aria-label="d.key"
          :class="['num', { out: d.out, today: d.key === today, on: d.key === model }]"
          @click="pick(d.date)">{{ d.date.getDate() }}</button>
      </div>
      <div class="date-foot">
        <button class="link" type="button" @click="pick(new Date())">今天</button>
        <button class="link" type="button" :disabled="!model" @click="clear">清空</button>
      </div>
    </div>
  </div>
</template>
