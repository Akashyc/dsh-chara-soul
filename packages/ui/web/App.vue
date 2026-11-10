<script setup>
import { ref, watch, onMounted } from 'vue';
import { state, current, api, load, guard, go } from './store.js';
import { adopt, look } from './theme/ui.js';
import Backdrop from './components/Backdrop.vue';
import Dossier from './components/Dossier.vue';
import DialogHost from './components/ui/DialogHost.vue';
import Toast from './components/ui/Toast.vue';
import BeingsPage from './components/BeingsPage.vue';
import CardPage from './components/CardPage.vue';
import ProfilePage from './components/ProfilePage.vue';
import GlobalPage from './components/GlobalPage.vue';
import MomentPage from './components/MomentPage.vue';
import MemoryPage from './components/MemoryPage.vue';
import SettingsPage from './components/SettingsPage.vue';
import ReleasePage from './components/ReleasePage.vue';

// [id, 名字, 英文小字, 图标路径（16×16 线稿）]
const TABS = [
  ['beings', '个体', 'Beings', 'M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.5 14c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5M11 7.5a2 2 0 1 0 0-4M12.5 9.8c1.2.6 2 1.9 2 3.7'],
  ['card', '角色卡', 'Card', 'M3 1.5h10v13H3zM6 5.5h4M5.5 8.5h5M5.5 11h3'],
  ['profile', '画像', 'Profile', 'M8 7.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 14.5c.5-3 2.7-5 5.5-5s5 2 5.5 5'],
  ['global', '全局提示词', 'Global', 'M2 3.5h12M2 8h12M2 12.5h8'],
  ['moment', '此刻', 'Moment', 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 4.5V8l2.5 2'],
  ['memory', '记忆', 'Memory', 'M8 1.5 14.5 5 8 8.5 1.5 5zM1.5 8 8 11.5 14.5 8M1.5 11 8 14.5 14.5 11'],
  ['settings', '设置', 'Settings', 'M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3'],
];
const PAGES = { beings: BeingsPage, card: CardPage, profile: ProfilePage, global: GlobalPage, moment: MomentPage, memory: MemoryPage, settings: SettingsPage, release: ReleasePage }; // 放生页不在页签里，从个体页进

/* 内嵌（DSH 侧栏面板等）：宿主只给宽度，一律单栏 */
const embed = new URLSearchParams(location.search).has('embed');
if (embed) document.documentElement.dataset.embed = '1';

/* 布局：≥1280 三栏，1024–1279 两栏，其余与内嵌单栏 */
const wide = matchMedia('(min-width: 1280px)');
const mid = matchMedia('(min-width: 1024px)');
const layout = ref('');
// 内嵌也按 iframe 实际宽度排：DSH 把面板放在主区，往往很宽
const lay = () => (layout.value = wide.matches ? 'three' : mid.matches ? 'two' : 'one');
wide.addEventListener('change', lay);
mid.addEventListener('change', lay);
lay();

/* 左侧读数：当前个体的记忆与日记，只取接口已有的数，拿不到就不显示 */
const reads = ref(null);
const refreshReads = async () => {
  const id = current.value?.id;
  if (!id || layout.value === 'one') return (reads.value = null);
  try {
    const [m, d] = await Promise.all([api('GET', `memories?id=${encodeURIComponent(id)}`), api('GET', `diaries?id=${encodeURIComponent(id)}`)]);
    const live = m.items.filter((x) => x.replaced_by == null);
    reads.value = {
      count: live.length,
      pinned: live.filter((x) => x.pinned).length,
      pending: live.filter((x) => x.kind === 'pending').length,
      diaries: d.length,
      vivid: live.length ? Math.round((live.reduce((s, x) => s + x.vividness, 0) / live.length) * 100) : null,
    };
  } catch {
    reads.value = null;
  }
};
watch(() => [current.value?.id, state.tab, layout.value, state.rev], refreshReads);

// 关窗口、刷新、侧栏面板被卸载时，浏览器自带的「离开此页」提示
addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});

onMounted(() => {
  guard(load)();
  // 外观以服务端为准（换端口不丢），本地缓存只管首屏不闪
  api('GET', 'settings').then((s) => adopt(s.ui), () => {});
});
</script>

<template>
  <Backdrop v-if="!look.skin" />
  <div :class="['shell', layout]">
    <aside v-if="layout !== 'one'" class="rail plate" aria-label="导航">
      <div class="brand">
        <svg viewBox="0 0 30 20" aria-hidden="true"><path d="M2 10c4-6 13-8 21-3l5-4v14l-5-4c-8 5-17 3-21-3Z" /><circle cx="9" cy="9" r="1" /></svg>
        chara soul
      </div>
      <nav class="nav" role="tablist" aria-label="页面" aria-orientation="vertical">
        <button v-for="[id, label, en, icon] in TABS" :key="id" role="tab" type="button" :aria-selected="state.tab === id" @click="go(id)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path :d="icon" /></svg>{{ label }}<span class="en">{{ en.toUpperCase() }}</span>
        </button>
      </nav>
      <div v-if="reads" class="reads" aria-label="当前个体读数">
        <div class="read"><b class="big num">{{ reads.count }}</b><span>记忆点<em>NODES</em></span></div>
        <div class="read"><b class="num">{{ reads.pinned }}</b><span>常驻<em>PINNED</em></span></div>
        <div class="read"><b class="num">{{ reads.pending }}</b><span>待续<em>PENDING</em></span></div>
        <div class="read"><b class="num">{{ reads.diaries }}</b><span>日记<em>DIARY</em></span></div>
        <div v-if="reads.vivid != null" class="read"><b class="num">{{ reads.vivid }}%</b><span>平均鲜明度<em>VIVID</em></span></div>
      </div>
    </aside>

    <main class="stage plate">
      <nav v-if="layout === 'one'" class="tabs" role="tablist" aria-label="页面">
        <button v-for="[id, label] in TABS" :key="id" role="tab" type="button" :aria-selected="state.tab === id" @click="go(id)">{{ label }}</button>
      </nav>
      <Dossier v-if="layout === 'two'" compact />
      <div :key="state.tab" class="page-in"><component :is="PAGES[state.tab]" /></div>
    </main>

    <Dossier v-if="layout === 'three'" />
  </div>
  <DialogHost />
  <Toast />
</template>
