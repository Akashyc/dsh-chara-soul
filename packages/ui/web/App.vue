<script setup>
import { ref, onMounted } from 'vue';
import { state, current, load, guard } from './store.js';
import Avatar from './components/Avatar.vue';
import BeingsPage from './components/BeingsPage.vue';
import CardPage from './components/CardPage.vue';
import ProfilePage from './components/ProfilePage.vue';
import MomentPage from './components/MomentPage.vue';
import SettingsPage from './components/SettingsPage.vue';

const TABS = [['beings', '个体'], ['card', '角色卡'], ['profile', '画像'], ['moment', '此刻'], ['settings', '设置']];
const PAGES = { beings: BeingsPage, card: CardPage, profile: ProfilePage, moment: MomentPage, settings: SettingsPage };

/* 内嵌（DSH 侧栏面板等）：宿主只给宽度，页面自己撑满；样式上用 data-embed 收紧留白、收起品牌行 */
const embed = new URLSearchParams(location.search).has('embed');
if (embed) document.documentElement.dataset.embed = '1';

/* 明暗：自动跟随系统，按钮在 自动 → 浅色 → 深色 之间切换；
   内嵌时以宿主推来的主题为准——宿主切明暗，这边跟着变，不留一黑一白的分界线 */
const media = matchMedia('(prefers-color-scheme: dark)');
const mode = ref(localStorage.getItem('chara-theme') ?? 'auto');
const forced = ref(''); // 宿主 postMessage 推来的 'dark' | 'light'；空串表示自己决定
const dark = ref(false);
function applyTheme() {
  const want = forced.value || (mode.value === 'auto' ? (media.matches ? 'dark' : 'light') : mode.value);
  dark.value = want === 'dark';
  document.documentElement.dataset.theme = want;
}
// 只认同源消息：跨源页面谁都发得出 postMessage，不能拿它当指令
addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data;
  if (!d || d.type !== 'chara:theme') return;
  forced.value = d.theme === 'dark' ? 'dark' : d.theme === 'light' ? 'light' : '';
  applyTheme();
});
function cycleTheme() {
  mode.value = { auto: 'light', light: 'dark', dark: 'auto' }[mode.value];
  localStorage.setItem('chara-theme', mode.value);
  applyTheme();
}
media.addEventListener('change', applyTheme);
applyTheme();

onMounted(guard(load));
</script>

<template>
  <div class="bubbles" aria-hidden="true">
    <i style="width:120px;height:120px;left:6%;top:18%"></i>
    <i style="width:60px;height:60px;left:86%;top:12%;animation-delay:-4s"></i>
    <i style="width:180px;height:180px;left:78%;top:62%;animation-delay:-8s"></i>
    <i style="width:44px;height:44px;left:30%;top:80%;animation-delay:-2s"></i>
  </div>
  <header>
    <span class="brand"><span class="holo-text">✦ chara soul</span></span>
    <span class="who">
      <template v-if="current"><Avatar :being="current" size="sm" /><span>当前 <b>{{ current.name }}</b></span></template>
      <span v-else>还没有个体</span>
    </span>
    <nav role="tablist" aria-label="页面">
      <button v-for="[id, label] in TABS" :key="id" role="tab" type="button" :aria-selected="state.tab === id" @click="state.tab = id">{{ label }}</button>
    </nav>
    <button class="btn theme" type="button" :aria-label="{ auto: '明暗：跟随系统', light: '明暗：浅色', dark: '明暗：深色' }[mode]" :title="{ auto: '明暗：跟随系统', light: '明暗：浅色', dark: '明暗：深色' }[mode]" @click="cycleTheme">
      {{ mode === 'auto' ? '◐' : dark ? '☾' : '☀' }}
    </button>
  </header>
  <main>
    <component :is="PAGES[state.tab]" />
  </main>
  <div :class="['toast', { show: state.toast?.show, bad: state.toast?.bad }]" role="status" aria-live="polite">{{ state.toast?.text }}</div>
</template>
