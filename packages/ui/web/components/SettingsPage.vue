<script setup>
import { ref, computed } from 'vue';
import { state, api, load, toast, guard } from '../store.js';
import Select from './Select.vue';
import TextField from './ui/TextField.vue';
import AppearancePanel from './AppearancePanel.vue';
import { ask } from './ui/dialog.js';

const settings = ref(null); // { envoyPreset, presets: [{ id, name }] | null, home: { home, source, previous, warning } }
const envoyPreset = ref('');
const target = ref('');
const moving = ref(false);
const picking = ref(false);

// 存的值不在已注册列表里时也列出来，免得显示成空白
const presetOptions = computed(() => {
  const list = settings.value.presets.map((p) => ({ value: p.id, label: `${p.name}（${p.id}）` }));

  return list.some((o) => o.value === envoyPreset.value) ? list : [{ value: envoyPreset.value, label: `${envoyPreset.value}（没有注册）` }, ...list];
});

/** 弹系统的选择文件夹对话框，选中的路径填进输入框；取消则不变。 */
const browse = guard(async () => {
  picking.value = true;

  try {
    const { path } = await api('POST', 'pick-folder');

    if (path) target.value = path;
  } finally {
    picking.value = false;
  }
});

/** 读设置与数据目录现状。 */
const refresh = guard(async () => {
  settings.value = await api('GET', 'settings');
  envoyPreset.value = settings.value.envoyPreset;
});

refresh();

/** 保存分身用的预设，下次派分身时生效。 */
const savePreset = guard(async () => {
  await api('PUT', 'settings', { envoyPreset: envoyPreset.value });
  toast('已保存，下次派分身时生效');
});

/** 把数据搬到新目录；确认后才动，搬的过程中按钮禁用防止重复点。 */
const moveHome = guard(async () => {
  const to = target.value.trim();

  if (!to || moving.value) return;
  if (!(await ask({ title: '迁移数据目录', confirm: '迁移', text: `把所有个体、记忆和画像复制到\n${to}\n复制并核对通过后改用新目录，旧目录保留，之后可以在这里删除。\n\n迁移前请关掉终端里的 npx chara ui。继续吗？` }))) return;
  moving.value = true;

  try {
    const info = await api('POST', 'home', { to });

    target.value = '';
    toast(info.warning ?? '已迁移到新目录');
    await refresh();
    await load();
  } finally {
    moving.value = false;
  }
});

/* 打迁移包：全部、只画像，或某一个个体；选好保存的文件夹再打，打进包的个体本机标为已迁出 */
const packTarget = ref('全部');
const packing = ref(false);
const packOptions = computed(() => [
  { value: '全部', label: '全部：所有个体和用户画像' },
  { value: '画像', label: '只打包用户画像（含头像与全局提示词）' },
  ...state.beings.filter((b) => b.status === 'awake' || b.status === 'dormant').map((b) => ({ value: b.id, label: `个体：${b.name}` })),
]);
const pack = guard(async () => {
  if (packing.value) return;
  packing.value = true;
  try {
    const { path } = await api('POST', 'pick-folder');
    if (!path) return;
    const moving = packTarget.value !== '画像';
    if (moving && !(await ask({ title: '打包迁移', confirm: '打包', text: `打包到\n${path}\n\n打进包的个体在本机标为已迁出，不能再切换过去；要撤销，在个体页点它唤醒。继续吗？` }))) return;
    toast((await api('POST', 'migrate', { target: packTarget.value, dir: path })).text.split('\n')[0]);
    await load();
  } finally {
    packing.value = false;
  }
});

/** 删除迁移后留下的旧目录里的数据，二次确认。 */
const removeOld = guard(async () => {
  if (!(await ask({ title: '删除旧目录', confirm: '删除', danger: true, text: `删除旧目录里的数据？\n${settings.value.home.previous}\n删除后不能恢复。` }))) return;
  await api('DELETE', 'home');
  toast('旧目录已删除');
  await refresh();
});
</script>

<template>
  <h2>设置 <span class="cap">Settings</span></h2>
  <AppearancePanel />
  <template v-if="settings">
    <!-- 分身用的预设：只有宿主列得出预设（目前只有 DSH）才有意义，独立运行时不显示 -->
    <div v-if="settings.presets?.length" class="panel">
      <div class="field">
        <label for="envoy-preset">分身用的预设</label>
        <Select id="envoy-preset" v-model="envoyPreset" :options="presetOptions" />
        <span class="muted">会话选「Soul·闲谈陪伴」或「Soul·全能女仆」时，派出的分身用这里的预设；会话用别的预设时，分身跟着会话走。</span>
      </div>
      <div class="actions"><button class="btn primary" type="button" @click="savePreset">保存</button></div>
    </div>

    <!-- 打迁移包：换电脑时用；导入在个体页 -->
    <div class="panel">
      <div class="field">
        <label for="pack-target">打包迁移</label>
        <Select id="pack-target" v-model="packTarget" :options="packOptions" />
        <span class="muted">打成一个 .soul 文件，带到另一台电脑上，在个体页「导入角色卡」里选它就行。打进包的个体在本机标为已迁出；只打包画像时个体不受影响。</span>
      </div>
      <div class="actions"><button class="btn primary" type="button" :disabled="packing" @click="pack">{{ packing ? '打包中…' : '选择文件夹并打包' }}</button></div>
    </div>

    <!-- 数据目录 -->
    <div class="panel">
      <div class="field">
        <label>数据目录</label>
        <code class="path">{{ settings.home.home }}</code>
        <span class="muted">{{ { env: '由环境变量 CHARA_SOUL_HOME 指定，不能在这里改', pointer: '换过位置', default: '默认位置' }[settings.home.source] }}</span>
        <span v-if="settings.home.warning" class="badge warn" style="align-self: flex-start">{{ settings.home.warning }}</span>
      </div>

      <div v-if="settings.home.source !== 'env'" class="field">
        <label for="home-target">迁移到</label>
        <div class="row">
          <TextField id="home-target" v-model="target" placeholder="空目录或还不存在的目录的完整路径，如 D:\灵魂" @keydown.enter="moveHome" />
          <button class="btn" type="button" :disabled="picking" @click="browse">选择文件夹</button>
        </div>
        <span class="muted">只复制不移动，核对无误后才切换。不要选网盘同步文件夹（OneDrive、坚果云等），同步会弄坏数据库。</span>
      </div>
      <div v-if="settings.home.source !== 'env'" class="actions">
        <button class="btn primary" type="button" :disabled="!target.trim() || moving" @click="moveHome">{{ moving ? '迁移中…' : '迁移' }}</button>
      </div>

      <div v-if="settings.home.previous" class="field" style="margin: 18px 0 0">
        <label>旧目录还在</label>
        <code class="path">{{ settings.home.previous }}</code>
        <div class="actions"><button class="btn danger" type="button" @click="removeOld">删除旧目录</button></div>
      </div>
    </div>
  </template>
</template>
