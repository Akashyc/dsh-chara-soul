<script setup>
// 全局唯一的弹窗：打开时焦点进弹窗、Tab 在弹窗里循环，Esc 等于取消，关闭后焦点回到原来的按钮
import { ref, watch, nextTick } from 'vue';
import { dialog, close } from './dialog.js';

const box = ref(null);
const ok = ref(null);
const cancel = ref(null);

watch(
  () => dialog.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    // 危险操作默认停在「取消」上，免得连按回车误删
    (dialog.danger ? cancel.value : ok.value)?.focus();
  },
);

function key(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    close(false);
  } else if (e.key === 'Tab') {
    const f = [...box.value.querySelectorAll('button')];
    const i = f.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 ? 0 : i + 1;
    e.preventDefault();
    f[next].focus();
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="dialog.open" class="scrim" @mousedown.self="close(false)">
      <div ref="box" :class="['dialog', 'plate', { danger: dialog.danger }]" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-text" @keydown="key">
        <div class="dialog-head">
          <h3 id="dlg-title">{{ dialog.title || '请确认' }}</h3>
          <button class="icon-btn" type="button" aria-label="关闭" @click="close(false)">×</button>
        </div>
        <p id="dlg-text" class="dialog-text">{{ dialog.text }}</p>
        <div class="dialog-actions">
          <button ref="cancel" class="btn" type="button" @click="close(false)">{{ dialog.cancel }}</button>
          <button ref="ok" :class="['btn', dialog.danger ? 'danger' : 'primary']" type="button" @click="close(true)">{{ dialog.confirm }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
