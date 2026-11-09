<script setup>
import { ref, reactive, computed, watch, watchEffect } from 'vue';
import { state, current, api, load, toast, guard, avatarUrl } from '../store.js';
import Avatar from './Avatar.vue';
import AvatarCrop from './AvatarCrop.vue';
import Fields from './Fields.vue';
import Select from './Select.vue';

const CARD = [
  ['name', '名字', '必填', 'input'],
  ['personality', '性格', '几条最能决定它怎么做事的特点', 8],
  ['speech', '口吻', '怎么说话、自称、口头禅；篇幅要求写在第一句最管用', 5],
  ['relationship', '和用户的关系', '你们是什么关系、怎么走到一起的；每个个体各写各的', 3],
  ['appearance', '外貌', '长什么样、标志性的动作；预算紧时最先被截掉', 4],
  ['first_mes', '开场白', '第一次见面说的话，也显示在个体卡片上', 3],
  ['mes_example', '对话示例', '语气参考，暂不注入', 4],
];
const NAMES = { personality: '性格', speech: '口吻', appearance: '外貌' };

const editing = ref(current.value?.id ?? state.beings[0]?.id ?? null);
const being = computed(() => state.beings.find((b) => b.id === editing.value));
const form = reactive({});
const pv = ref(null);
const saved = ref('{}'); // 上次读入或保存时的表单快照（读入前和空表单一致，不算有改动），用来判断有没有没保存的改动
const dirty = computed(() => JSON.stringify(form) !== saved.value);
watchEffect(() => (state.dirty = dirty.value)); // 交给 App 在切页签、关页面前提醒
const beingOptions = computed(() => state.beings.map((b) => ({ value: b.id, label: b.name, being: b })));

/**
 * 读入一个个体的角色卡；有没保存的改动时先确认，免得切走就丢。
 * @param id 个体 id
 */
const open = guard(async (id) => {
  if (id !== editing.value && dirty.value && !confirm('角色卡有改动还没保存，切换会丢掉这些改动，继续吗？')) return;
  editing.value = id;
  const card = await api('GET', `card?id=${encodeURIComponent(id)}`);
  for (const [k] of CARD) form[k] = typeof card[k] === 'string' ? card[k].replace(/\n$/, '') : '';
  saved.value = JSON.stringify(form);
  versions.value = await api('GET', `card-versions?id=${encodeURIComponent(id)}`);
});

// 历史版本：每次改卡存上一版，最多 20 份；回滚时当前这版也存进去，所以回滚也能撤回
const versions = ref([]);
const when = (t) => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const restore = guard(async (v) => {
  if (!confirm(`回滚到 ${when(v.at)} 换下的「${v.name}」？${dirty.value ? '没保存的改动会丢掉。' : ''}当前这版会存进历史。`)) return;
  await api('POST', `card-versions?id=${encodeURIComponent(editing.value)}&vid=${v.id}`);
  saved.value = JSON.stringify(form); // 不再提示没保存的改动
  await open(editing.value);
  await load();
  toast('已回滚，下一轮生效');
});
if (editing.value) open(editing.value);

// 改动 300ms 后重算本性预览
let timer;
watch(form, () => {
  clearTimeout(timer);
  timer = setTimeout(guard(async () => (pv.value = await api('POST', 'preview', { ...form }))), 300);
});

const save = guard(async () => {
  await api('PUT', `card?id=${encodeURIComponent(editing.value)}`, { ...form });
  saved.value = JSON.stringify(form);
  toast('已保存，下一轮生效');
  versions.value = await api('GET', `card-versions?id=${encodeURIComponent(editing.value)}`);
  await load();
});

const file = ref(null);
const cropSrc = ref(''); // 正在裁剪的图片地址，空串表示弹窗没开

/** 选好文件后先打开裁剪弹窗，不直接上传。 */
function pickAvatar() {
  const f = file.value.files[0];

  file.value.value = '';
  if (f) cropSrc.value = URL.createObjectURL(f);
}

/** 关掉裁剪弹窗，释放本地图片占的内存。 */
function closeCrop() {
  URL.revokeObjectURL(cropSrc.value);
  cropSrc.value = '';
}

/**
 * 上传裁好的头像，刷新列表后关掉弹窗。
 * @param blob 裁剪弹窗导出的正方形图片
 */
const saveAvatar = guard(async (blob) => {
  await api('PUT', `avatar?id=${encodeURIComponent(editing.value)}`, await blob.arrayBuffer(), true);
  closeCrop();
  await load();
  toast('头像已更换');
});

const portraitFile = ref(null);
const viewer = ref(null);

/** 选好形象图直接上传，原图不裁不压。 */
const savePortrait = guard(async () => {
  const f = portraitFile.value.files[0];

  portraitFile.value.value = '';
  if (!f) return;
  await api('PUT', `portrait?id=${encodeURIComponent(editing.value)}`, await f.arrayBuffer(), true);
  await load();
  toast('形象图已更换');
});
</script>

<template>
  <h2>角色卡</h2>
  <div v-if="!state.beings.length" class="panel empty"><p class="muted">先在「个体」页新建或导入一个个体。</p></div>
  <div v-else class="editor">
    <div class="panel">
      <div class="field">
        <label for="card-being">编辑哪个个体</label>
        <Select id="card-being" :model-value="editing" :options="beingOptions" @update:model-value="open">
          <template #option="{ option }"><Avatar :being="option.being" size="sm" />{{ option.label }}</template>
        </Select>
      </div>
      <div class="field">
        <label>头像</label>
        <div class="row" style="gap: 14px; flex-wrap: wrap">
          <Avatar v-if="being" :being="being" />
          <button class="btn" type="button" @click="file.click()">换头像</button>
          <span class="muted">PNG、JPG、WebP，选好后裁剪</span>
        </div>
        <input ref="file" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="pickAvatar">
        <AvatarCrop v-if="cropSrc" :src="cropSrc" @done="saveAvatar" @close="closeCrop" />
      </div>

      <!-- 形象图 -->
      <div class="field">
        <label>形象图</label>
        <button v-if="being?.portrait" class="portrait" type="button" aria-label="放大查看形象图" @click="viewer.showModal()">
          <img :src="avatarUrl(being, 'portrait')" alt="">
        </button>
        <div class="row" style="gap: 14px; flex-wrap: wrap">
          <button class="btn" type="button" @click="portraitFile.click()">换形象图</button>
          <span class="muted">大图原样保存，点图放大</span>
        </div>
        <input ref="portraitFile" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="savePortrait">
        <dialog ref="viewer" class="viewer" aria-label="形象图" @click="viewer.close()">
          <img v-if="being?.portrait" :src="avatarUrl(being, 'portrait')" alt="">
        </dialog>
      </div>
      <Fields v-model="form" :spec="CARD" :cut="pv?.cut" />
      <p class="muted">保存后下一轮生效。会按标准格式重写 card.yaml，你自己加的注释会丢掉；世界书条目原样保留。</p>

      <!-- 保存条 -->
      <div class="actions save-bar">
        <button class="btn primary" type="button" :disabled="!dirty" @click="save">保存</button>
        <span :class="dirty ? 'dirty' : 'muted'">{{ dirty ? '有改动还没保存' : '已保存' }}</span>
      </div>

      <!-- 历史版本 -->
      <details class="field">
        <summary>历史版本（{{ versions.length }}）</summary>
        <p v-if="!versions.length" class="muted">还没改过。每次保存或手改 card.yaml，上一版都会存在这里，最多留 20 份。</p>
        <ul v-else class="versions">
          <li v-for="v in versions" :key="v.id" class="row" style="gap: 10px">
            <span>{{ when(v.at) }} 换下的「{{ v.name }}」</span>
            <button class="btn" type="button" @click="restore(v)">回滚到这版</button>
          </li>
        </ul>
      </details>
    </div>
    <div class="panel preview">
      <div class="actions" style="justify-content: space-between; margin-bottom: 8px">
        <b>本性预览</b><span v-if="pv" class="muted">{{ pv.length }} / {{ pv.budget }} 字</span>
      </div>
      <div :class="['meter', { over: pv?.cut.length }]"><i :style="{ width: pv ? `${Math.min(100, (pv.length / pv.budget) * 100)}%` : 0 }"></i></div>
      <p v-if="pv" class="muted">
        {{ pv.cut.length ? `超出预算，被截掉的部分：${pv.cut.map((k) => NAMES[k]).join('、')}。底线不会被截。` : '在预算之内，全部内容都会注入。' }}
      </p>
      <pre>{{ pv?.nature }}</pre>
    </div>
  </div>
</template>
