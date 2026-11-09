<script setup>
// 右侧个体档案（宽屏）；compact 时折成中间面板顶部的一条摘要（两栏）。只用 /api/state 已有的数据
import { computed } from 'vue';
import { state, current, avatarUrl, use, sleep, go, guard, STATUS, ageText, seenText } from '../store.js';
import Avatar from './Avatar.vue';

defineProps({ compact: Boolean });
const b = current;
const index = computed(() => state.beings.indexOf(b.value) + 1);
const others = computed(() => state.beings.filter((x) => !x.current && x.status !== 'released'));
// 从 /chara show 的文字里拆此刻几行和本性字数，同此刻页
const part = (re) => (state.show.match(re) ?? [])[1] ?? '';
const lines = computed(() => part(/【此刻】\n([\s\S]*?)(?:\n\n⚠|$)/).split('\n').filter(Boolean));
const natureLen = computed(() => [...part(/【本性】\n([\s\S]*?)(?:\n\n【此刻】|$)/)].length);
const pad = (n) => String(n).padStart(2, '0');
</script>

<template>
  <div v-if="compact" class="summary">
    <template v-if="b">
      <Avatar :being="b" size="sm" />
      <b>{{ b.name }}</b>
      <span class="state">当前个体</span>
      <span class="muted">{{ ageText(b) }} · {{ seenText(b) }}</span>
    </template>
    <span v-else class="muted">还没有个体</span>
  </div>

  <aside v-else class="dossier plate" aria-label="个体档案">
    <div class="head">
      <span><b>个体档案</b> <span class="cap">Agent dossier</span></span>
      <span v-if="b" class="cap num">{{ pad(index) }} / {{ pad(state.beings.length) }}</span>
    </div>
    <p v-if="!b" class="muted">还没有个体。在「个体」页新建或导入一个。</p>
    <template v-else>
      <div class="who">
        <img v-if="b.portrait || b.avatar" class="face" alt="" :src="avatarUrl(b, b.portrait ? 'portrait' : 'avatar')">
        <span v-else class="face mono" aria-hidden="true">{{ [...b.name][0] }}</span>
        <div>
          <div class="name">{{ b.name }}</div>
          <span class="state">清醒 · 当前个体</span>
          <div class="kv"><span>出生</span><b class="num">{{ b.bornDays == null ? '—' : `${b.bornDays} 天` }}</b></div>
          <div class="kv"><span>上次见面</span><b>{{ b.lastSeen ?? '—' }}</b></div>
          <div class="kv"><span>世界书</span><b class="num">{{ b.lorebook }} 条</b></div>
        </div>
      </div>
      <div v-if="b.first_mes" class="quote"><span class="cap">开场白 First message</span>{{ b.first_mes }}</div>
      <div class="sec" style="margin-bottom: 0">
        <b>此刻</b><span class="cap">Moment · 下一轮注入</span>
        <span class="muted num" style="margin-left: auto">本性 {{ natureLen }} 字</span>
      </div>
      <div class="lines-sm"><div v-for="l in lines" :key="l" :title="l">{{ l }}</div></div>
      <template v-if="others.length">
        <span class="cap">其他个体 Other beings</span>
        <div class="others">
          <button v-for="o in others" :key="o.id" class="other" type="button" :aria-label="`切换到 ${o.name}`" @click="guard(use)(o)">
            <Avatar :being="o" size="sm" />{{ o.name }}
            <span class="muted">{{ o.status !== 'awake' ? STATUS[o.status] : `${ageText(o)} · ${seenText(o)}` }}</span>
          </button>
        </div>
      </template>
      <div class="acts">
        <button class="btn primary" type="button" @click="go('card')">编辑角色卡</button>
        <button class="btn" type="button" @click="guard(sleep)(b)">休眠</button>
        <button class="btn danger" type="button" @click="state.releasing = b.id; go('release')">放生</button>
      </div>
    </template>
  </aside>
</template>
