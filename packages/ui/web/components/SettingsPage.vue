<script setup>
import { ref, computed } from 'vue';
import { api, load, toast, guard } from '../store.js';
import Select from './Select.vue';

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
  if (!confirm(`把所有个体、记忆和画像复制到\n${to}\n复制并核对通过后改用新目录，旧目录保留，之后可以在这里删除。\n\n迁移前请关掉终端里的 npx chara ui。继续吗？`)) return;
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

/** 删除迁移后留下的旧目录里的数据，二次确认。 */
const removeOld = guard(async () => {
  if (!confirm(`删除旧目录里的数据？\n${settings.value.home.previous}\n删除后不能恢复。`)) return;
  await api('DELETE', 'home');
  toast('旧目录已删除');
  await refresh();
});
</script>

<template>
  <h2>设置</h2>
  <template v-if="settings">
    <!-- 分身用的预设：只有宿主列得出预设（目前只有 DSH）才有意义，独立运行时不显示 -->
    <div v-if="settings.presets?.length" class="panel" style="max-width: 760px; margin-bottom: 18px">
      <div class="field">
        <label for="envoy-preset">分身用的预设</label>
        <Select id="envoy-preset" v-model="envoyPreset" :options="presetOptions" />
        <span class="muted">会话选「角色灵魂」预设时，本体工具很少，派出的分身改用这里的预设拿全套工具；会话用别的预设时，分身照旧跟着会话走。</span>
      </div>
      <div class="actions"><button class="btn primary" type="button" @click="savePreset">保存</button></div>
    </div>

    <!-- 数据目录 -->
    <div class="panel" style="max-width: 760px">
      <div class="field">
        <label>数据目录</label>
        <code class="path">{{ settings.home.home }}</code>
        <span class="muted">{{ { env: '由环境变量 CHARA_SOUL_HOME 指定，不能在这里改', pointer: '换过位置', default: '默认位置' }[settings.home.source] }}</span>
        <span v-if="settings.home.warning" class="badge warn" style="align-self: flex-start">{{ settings.home.warning }}</span>
      </div>

      <div v-if="settings.home.source !== 'env'" class="field">
        <label for="home-target">迁移到</label>
        <div class="row">
          <input id="home-target" v-model="target" placeholder="空目录或还不存在的目录的完整路径，如 D:\灵魂" @keydown.enter="moveHome">
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
        <div class="actions"><button class="btn" type="button" @click="removeOld">删除旧目录</button></div>
      </div>
    </div>
  </template>
</template>
