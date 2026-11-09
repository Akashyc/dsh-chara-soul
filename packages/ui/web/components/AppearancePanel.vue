<script setup>
// 外观：主题色（7 个预设 + 自制色盘）、背景三个开关、明暗。选的时候整页实时预览，「保存」才写进服务端设置，「取消」退回
import { ref, computed, onBeforeUnmount } from 'vue';
import { api, toast, guard } from '../store.js';
import { ui, saved, look, revert, persist } from '../theme/ui.js';
import { PRESETS, DEFAULT_ACCENT, accentContrast, accentText, contrast, SURFACE } from '../theme/accent.js';
import ColorPicker from './ui/ColorPicker.vue';
import Switch from './ui/Switch.vue';
import Segmented from './ui/Segmented.vue';

const THEMES = [{ value: 'dark', label: '深色' }, { value: 'light', label: '浅色' }, { value: 'auto', label: '跟随系统' }];
const BACKDROP = [['stars', '星空背景', '深空底色与星点'], ['lattice', '神经连线', '节点与连线跟随主题色'], ['pulse', '节点脉动', '亮节点缓慢明暗变化；系统开了「减少动态效果」时不动']];

const mode = computed(() => (look.dark ? 'dark' : 'light'));
const preset = computed(() => PRESETS.find(([, hex]) => hex === ui.accent.toUpperCase()));
const ratio = computed(() => accentContrast(ui.accent, mode.value));
const tx = computed(() => accentText(ui.accent, mode.value));
const txRatio = computed(() => contrast(tx.value, SURFACE[mode.value]));
const dirty = computed(() => JSON.stringify({ ...ui, backdrop: { ...ui.backdrop } }) !== JSON.stringify({ ...saved, backdrop: { ...saved.backdrop } }));
const picker = ref(null);

const save = guard(async () => {
  await persist((next) => api('PUT', 'settings', { ui: next }));
  toast('外观已保存');
});
onBeforeUnmount(revert); // 没保存就离开设置页：退回已保存的
</script>

<template>
  <div class="panel">
    <div class="sec"><b>主题色</b><span class="cap">Accent</span><span class="muted" style="margin-left: auto">只选一个颜色，其余配色自动推算</span></div>
    <div class="swatches" role="group" aria-label="预设主题色">
      <button v-for="[name, hex] in PRESETS" :key="hex" class="swatch" type="button" :aria-pressed="preset?.[1] === hex" @click="ui.accent = hex">
        <i :style="{ backgroundColor: hex }"></i>{{ name }}
      </button>
      <button class="swatch add" type="button" :aria-pressed="!preset" @click="picker?.querySelector('.cp-sv')?.focus()"><i aria-hidden="true">+</i>自定义</button>
    </div>
    <div ref="picker">
      <ColorPicker v-model="ui.accent">
        <p class="muted num" style="margin: 4px 0 0">
          与{{ look.dark ? '深' : '浅' }}色底对比度 {{ ratio.toFixed(1) }} : 1 · 小字自动改用{{ look.dark ? '亮' : '深' }}色文字（{{ txRatio.toFixed(1) }} : 1）
        </p>
        <p v-if="ratio < 3" class="hint bad" role="status">这个颜色在当前底色上不够清楚</p>
      </ColorPicker>
    </div>

    <div class="sec" style="margin-top: 24px"><b>自动推算</b><span class="cap">Derived tokens</span></div>
    <div class="tokens">
      <div class="token"><i style="background: var(--ac)"></i>主色 · 选中条、主按钮<span class="num">{{ ui.accent.toUpperCase() }}</span></div>
      <div class="token"><i style="background: var(--ac-soft)"></i>浅底 · 选中项背景<span class="num">16%</span></div>
      <div class="token"><i :style="{ background: tx }"></i>{{ look.dark ? '亮' : '深' }}色文字 · 底上的小字<span class="num">{{ tx }}</span></div>
      <div class="token"><i style="background: var(--ac-line)"></i>描边 · 输入框聚焦<span class="num">75%</span></div>
    </div>

    <div class="sec" style="margin-top: 24px; margin-bottom: 0"><b>背景与动效</b><span class="cap">Backdrop</span></div>
    <div v-for="[k, label, hint] in BACKDROP" :key="k" class="opt">
      <div>{{ label }}<span class="muted">{{ hint }}</span></div>
      <Switch v-model="ui.backdrop[k]" :label="label" />
    </div>
    <div class="opt">
      <div>明暗<span class="muted">{{ look.forced ? '内嵌时跟着宿主走，这里的选择在单独打开时生效' : '深色为主；浅色沿用同一套结构' }}</span></div>
      <Segmented v-model="ui.theme" :options="THEMES" label="明暗" />
    </div>

    <div class="actions" style="margin-top: 20px">
      <button class="btn" type="button" :disabled="ui.accent === DEFAULT_ACCENT" @click="ui.accent = DEFAULT_ACCENT">恢复默认</button>
      <span style="flex: 1"></span>
      <button class="btn" type="button" :disabled="!dirty" @click="revert">取消</button>
      <button class="btn primary" type="button" :disabled="!dirty" @click="save">保存</button>
    </div>
  </div>
</template>
