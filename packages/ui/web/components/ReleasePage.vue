<script setup>
// 放生（004 号决定 2026-11-09 修订）：不打包数据库，用户挑着带——回忆、日记、关于你的一句话、履历；整页预览、两次确认后才打包并删掉本机文件
import { ref, computed } from 'vue';
import { state, api, load, toast, guard } from '../store.js';

const draft = ref(null);
const mems = ref([]); // 选中的记忆点 id
const days = ref([]); // 选中的日记日期
const withProfile = ref(false);
const profileLine = ref('');
const resume = ref('');
const drafting = ref(false);
const releasing = ref(false);
const q = () => `id=${encodeURIComponent(state.releasing)}`;

const refresh = guard(async () => {
  draft.value = await api('GET', `release?${q()}`);
  profileLine.value = draft.value.profileLine;
});
refresh();

const back = () => (state.tab = 'beings');
const chosenMems = computed(() => draft.value?.memories.filter((m) => mems.value.includes(m.id)) ?? []);
const chosenDays = computed(() => draft.value?.diaries.filter((d) => days.value.includes(d.day)) ?? []);
const line = computed(() => (withProfile.value ? profileLine.value.trim() : ''));

/** 一键起草履历：用选中的回忆和日记调一次模型；已有履历时先确认再替换。 */
const draftResume = guard(async () => {
  if (resume.value.trim() && !confirm('重新起草会替换现在的履历，继续吗？')) return;
  drafting.value = true;
  try {
    resume.value = (await api('POST', `release/resume?${q()}`, { memories: mems.value, diaries: days.value })).text;
  } finally {
    drafting.value = false;
  }
});

/** 放生：确认带走什么、选保存的文件夹、最后再确认一次。本机文件随后删除，不能恢复。 */
const go = guard(async () => {
  if (releasing.value) return;
  const name = draft.value.name;
  const what = `${chosenMems.value.length} 条回忆、${chosenDays.value.length} 篇日记${line.value ? '、关于你的一句话' : ''}${resume.value.trim() ? '、履历' : ''}`;
  if (!confirm(`放生「${name}」？\n\n带走：角色卡、头像和形象图、${what}。\n本机的原话、记忆点和日记会全部删除，不能恢复。`)) return;
  releasing.value = true;
  try {
    const { path } = await api('POST', 'pick-folder');
    if (!path) return;
    if (!confirm(`最后确认：放生「${name}」，放生包存到\n${path}`)) return;
    const r = await api('POST', `release?${q()}`, { memories: mems.value, diaries: days.value, profileLine: line.value, resume: resume.value, dir: path });
    toast(r.text.split('\n')[0]);
    state.releasing = null;
    state.tab = 'beings';
    await load();
  } finally {
    releasing.value = false;
  }
});
</script>

<template>
  <h2>放生{{ draft ? `「${draft.name}」` : '' }}</h2>
  <div v-if="draft" class="release">
    <div class="panel">
      <p>放生是让它离开你，去一位新主人那里。它只带走你在下面挑的东西：<b>原话不带，没勾的回忆和日记不带</b>。打包后本机的一切都会删除，名册里留一行记录。</p>
      <p class="muted">相处时长：{{ draft.together }}。挑回忆时想一想：这些话交给陌生人也没关系吗？</p>
      <button class="link" type="button" @click="back">← 不放生了，回个体页</button>
    </div>

    <div class="panel">
      <div class="field">
        <label>带走的回忆（{{ mems.length }} / {{ draft.memories.length }}）</label>
        <div class="row">
          <button class="link" type="button" @click="mems = draft.memories.map((m) => m.id)">全选</button>
          <button class="link" type="button" @click="mems = []">全不选</button>
        </div>
      </div>
      <div class="picks">
        <label v-for="m in draft.memories" :key="m.id" class="pick">
          <input v-model="mems" type="checkbox" :value="m.id">
          <span><span class="badge silver">{{ draft.kinds[m.kind] ?? m.kind }}</span> {{ m.text }}</span>
        </label>
        <p v-if="!draft.memories.length" class="muted">它还没有记下什么。</p>
      </div>
    </div>

    <div class="panel">
      <div class="field"><label>带走的日记（{{ days.length }} / {{ draft.diaries.length }}）</label></div>
      <div class="picks">
        <label v-for="d in draft.diaries" :key="d.day" class="pick">
          <input v-model="days" type="checkbox" :value="d.day">
          <span><b>{{ d.day }}</b> {{ d.text }}</span>
        </label>
        <p v-if="!draft.diaries.length" class="muted">还没写过日记。</p>
      </div>
    </div>

    <div class="panel">
      <label class="pick"><input v-model="withProfile" type="checkbox"><b>带一句关于你的回忆</b></label>
      <div v-if="withProfile" class="field">
        <textarea v-model="profileLine" rows="3" maxlength="2000" aria-label="关于你的一句话" placeholder="如：我陪过一位前主人，是个温柔又有点倔的人。"></textarea>
        <span class="muted">从你的画像起草，没带名字和称呼。改到你愿意让陌生人看到为止。</span>
      </div>
    </div>

    <div class="panel">
      <div class="field">
        <label for="resume">履历</label>
        <textarea id="resume" v-model="resume" rows="8" maxlength="2000" placeholder="它的一份自我介绍，给新主人看。可以一键起草，也可以自己写，或者留空。"></textarea>
        <span class="muted">起草只用你勾选的回忆和日记，要求模型不写名字、地点、精确日期和私事；起草完一定要读一遍。要调用模型，只在 DSH 里能用。</span>
      </div>
      <div class="actions"><button class="btn" type="button" :disabled="drafting" @click="draftResume">{{ drafting ? '起草中…' : '一键起草履历' }}</button></div>
    </div>

    <div class="panel preview">
      <div class="field"><label>放生包里会有</label></div>
      <ul>
        <li>角色卡、你自己传的头像和形象图</li>
        <li v-for="m in chosenMems" :key="m.id">回忆：{{ m.text }}</li>
        <li v-for="d in chosenDays" :key="d.day">日记 {{ d.day }}</li>
        <li v-if="line">关于你：{{ line }}</li>
        <li v-if="resume.trim()">履历：{{ resume.trim() }}</li>
      </ul>
      <div class="actions"><button class="btn primary" type="button" :disabled="releasing" @click="go">{{ releasing ? '放生中…' : '选择文件夹并放生' }}</button></div>
    </div>
  </div>
</template>
