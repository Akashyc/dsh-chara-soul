<script setup>
// 下拉选择：原生 select 的弹出列表跟不了主题，这里自己画。键盘与读屏按「只选不输」的 combobox 写法
import { ref, computed, watch, nextTick, useId } from 'vue';

const props = defineProps({
  options: { type: Array, required: true }, // [{ value, label }]，其余字段原样交给 option 插槽
  id: { type: String, default: undefined },
  placeholder: { type: String, default: '请选择' },
});
const model = defineModel();

const listId = useId();
const open = ref(false);
const active = ref(0);
const list = ref(null);

const selected = computed(() => props.options.find((o) => o.value === model.value));

/** 打开列表，高亮当前选中项。 */
function show() {
  active.value = Math.max(0, props.options.indexOf(selected.value));
  open.value = true;
}

/**
 * 选中一项并收起。
 * @param i 选项下标
 */
function choose(i) {
  model.value = props.options[i].value;
  open.value = false;
}

/** 方向键移动高亮，回车或空格选中，Esc 收起。 */
function onKey(e) {
  const last = props.options.length - 1;
  const move = { ArrowDown: active.value + 1, ArrowUp: active.value - 1, Home: 0, End: last }[e.key];

  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      show();
    }
    return;
  }

  if (move !== undefined) {
    e.preventDefault();
    active.value = Math.min(last, Math.max(0, move));
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    choose(active.value);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    open.value = false;
  }
}

// 高亮项滚进可视范围，选项多时键盘也能翻到底
watch([open, active], async () => {
  await nextTick();
  list.value?.children[active.value]?.scrollIntoView({ block: 'nearest' });
});
</script>

<template>
  <div :class="['select', { open }]">
    <button
      :id="id"
      class="select-trigger"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-activedescendant="open ? `${listId}-${active}` : undefined"
      @click="open ? (open = false) : show()"
      @keydown="onKey"
      @blur="open = false">
      <span class="select-value">
        <slot v-if="selected" name="option" :option="selected">{{ selected.label }}</slot>
        <span v-else class="muted">{{ placeholder }}</span>
      </span>
      <span class="select-arrow" aria-hidden="true"></span>
    </button>

    <!-- 选项列表：mousedown 阻止默认，焦点留在按钮上，点选项或拖滚动条时 blur 才不会抢先把列表关掉 -->
    <ul v-show="open" :id="listId" ref="list" class="select-list" role="listbox" @mousedown.prevent>
      <li
        v-for="(o, i) in options"
        :id="`${listId}-${i}`"
        :key="o.value"
        role="option"
        :aria-selected="o.value === model"
        :class="{ active: i === active }"
        @mousemove="active = i"
        @click="choose(i)">
        <slot name="option" :option="o">{{ o.label }}</slot>
      </li>
    </ul>
  </div>
</template>
