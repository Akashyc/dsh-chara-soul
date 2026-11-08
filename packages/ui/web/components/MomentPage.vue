<script setup>
import { computed } from 'vue';
import { state, current, load, guard, colorOf, ageText, seenText } from '../store.js';
import Avatar from './Avatar.vue';

guard(load)(); // 此刻随时间变化，进页面就刷新一次

// 从 /chara show 的文字里拆出本性、此刻和警告
const part = (re) => (state.show.match(re) ?? [])[1] ?? '';
const nature = computed(() => part(/【本性】\n([\s\S]*?)(?:\n\n【此刻】|$)/));
const lines = computed(() => part(/【此刻】\n([\s\S]*?)(?:\n\n⚠|$)/).split('\n').filter(Boolean));
const warn = computed(() => (state.show.match(/⚠.*/) ?? [])[0]);
</script>

<template>
  <h2>此刻</h2>
  <div v-if="!current" class="panel empty"><p>还没有个体，本轮不注入任何内容。</p></div>
  <div v-else class="now">
    <div class="panel me" :style="{ '--c': colorOf(current) }">
      <Avatar :being="current" size="lg" />
      <div style="font-size: 24px; font-weight: 800">{{ current.name }}</div>
      <span class="badge">{{ ageText(current) }}</span>
      <span class="muted">{{ seenText(current) }}</span>
    </div>
    <div class="panel">
      <b>它现在感知到的</b>
      <p class="muted" style="margin-top: 4px">每一轮都会注入的「此刻」，5 分钟内保持不变</p>
      <div class="lines"><div v-for="l in lines" :key="l">{{ l }}</div></div>
      <p v-if="warn" class="badge warn" style="margin-top: 14px">{{ warn }}</p>
      <details>
        <summary>本性全文（{{ [...nature].length }} 字）</summary>
        <pre>{{ nature }}</pre>
      </details>
    </div>
  </div>
</template>
