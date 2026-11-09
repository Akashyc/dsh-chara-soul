<script setup>
// 放表单的弹窗：样子与确认弹窗一致。打开时焦点进第一个可填的控件，Tab 在弹窗里循环，Esc 和点遮罩等于关闭，关闭后焦点回到原来的按钮
import { ref, watch, nextTick } from 'vue';

const props = defineProps({ open: Boolean, title: { type: String, required: true } });
const emit = defineEmits(['close']);
const box = ref(null);
let back = null;

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

watch(
  () => props.open,
  async (open) => {
    if (!open) return void back?.focus?.();
    back = document.activeElement;
    await nextTick();
    // 跳过右上角的关闭按钮，直接落在第一个要填的地方
    box.value?.querySelector('.modal-body')?.querySelector(FOCUSABLE)?.focus();
  },
);

function key(e) {
  // 里面的下拉、日期面板先处理自己的 Esc
  if (e.key === 'Escape' && !e.defaultPrevented) {
    e.preventDefault();
    emit('close');
  } else if (e.key === 'Tab') {
    const f = [...box.value.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey ? i <= 0 : i === f.length - 1) {
      e.preventDefault();
      f[e.shiftKey ? f.length - 1 : 0].focus();
    }
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="scrim" @mousedown.self="emit('close')">
      <div ref="box" class="dialog modal plate" role="dialog" aria-modal="true" aria-labelledby="modal-title" @keydown="key">
        <div class="dialog-head">
          <h3 id="modal-title">{{ title }}</h3>
          <button class="icon-btn" type="button" aria-label="关闭" @click="emit('close')">×</button>
        </div>
        <div class="modal-body"><slot /></div>
        <div class="dialog-actions"><slot name="actions" /></div>
      </div>
    </div>
  </Teleport>
</template>
