<script setup>
import { ref, computed, onMounted } from 'vue';
import Slider from './ui/Slider.vue';

defineProps({ src: { type: String, required: true } });
const emit = defineEmits(['done', 'close']);

// 取景框边长（CSS 像素）与导出边长；导出成正方形，圆形只是显示效果
const VIEW = 280;
const OUT = 512;

const dialog = ref(null);
const img = ref(null);
const size = ref(null); // 图片原始宽高 { w, h }，加载前为 null
const zoom = ref(1);
const pos = ref({ x: 0, y: 0 }); // 图片左上角相对取景框的位置
let drag = null;

/** 图片铺满取景框时的缩放比，再乘上用户的放大倍数。 */
const scale = computed(() => (size.value ? (VIEW / Math.min(size.value.w, size.value.h)) * zoom.value : 1));

const imgStyle = computed(() => ({
  width: `${size.value ? size.value.w * scale.value : 0}px`,
  transform: `translate(${pos.value.x}px, ${pos.value.y}px)`,
}));

onMounted(() => dialog.value.showModal());

/**
 * 把位置限制在图片仍铺满取景框的范围内，不露出空白。
 * @param x 图片左上角横坐标
 * @param y 图片左上角纵坐标
 */
function place(x, y) {
  const w = size.value.w * scale.value;
  const h = size.value.h * scale.value;

  pos.value = { x: Math.min(0, Math.max(VIEW - w, x)), y: Math.min(0, Math.max(VIEW - h, y)) };
}

/** 图片加载后记下原始尺寸并居中。 */
function loaded() {
  const { naturalWidth: w, naturalHeight: h } = img.value;

  size.value = { w, h };
  zoom.value = 1;
  place((VIEW - w * scale.value) / 2, (VIEW - h * scale.value) / 2);
}

/**
 * 改放大倍数，并保持取景框中心对着图片上的同一点。
 * @param z 新的放大倍数，1 到 4
 */
function setZoom(z) {
  const old = scale.value;
  const c = VIEW / 2;

  zoom.value = Math.min(4, Math.max(1, z));
  place(c - ((c - pos.value.x) / old) * scale.value, c - ((c - pos.value.y) / old) * scale.value);
}

/** 按下时记住起点，开始拖动。 */
function down(e) {
  e.currentTarget.setPointerCapture(e.pointerId);
  drag = { x: e.clientX - pos.value.x, y: e.clientY - pos.value.y };
}

/** 拖动中跟着指针移动图片。 */
function move(e) {
  if (drag) place(e.clientX - drag.x, e.clientY - drag.y);
}

/** 方向键挪图片，加减号缩放，键盘也能用。 */
function key(e) {
  const step = { ArrowLeft: [10, 0], ArrowRight: [-10, 0], ArrowUp: [0, 10], ArrowDown: [0, -10] }[e.key];

  if (step) {
    e.preventDefault();
    place(pos.value.x + step[0], pos.value.y + step[1]);
  } else if (e.key === '+' || e.key === '=') {
    setZoom(zoom.value + 0.1);
  } else if (e.key === '-') {
    setZoom(zoom.value - 0.1);
  }
}

/** 按取景框裁出正方形，导出 WebP（浏览器不支持时自动退回 PNG），交给父组件上传。 */
function crop() {
  const canvas = document.createElement('canvas');
  const s = scale.value;

  canvas.width = canvas.height = OUT;
  canvas.getContext('2d').drawImage(img.value, -pos.value.x / s, -pos.value.y / s, VIEW / s, VIEW / s, 0, 0, OUT, OUT);
  canvas.toBlob((blob) => blob && emit('done', blob), 'image/webp', 0.9);
}
</script>

<template>
  <!-- 头像裁剪弹窗 -->
  <dialog ref="dialog" class="crop" aria-label="裁剪头像" @close="emit('close')">
    <h3>裁剪头像</h3>

    <!-- 取景框 -->
    <div
      class="crop-view"
      tabindex="0"
      aria-label="拖动或用方向键移动图片，加减号缩放"
      :style="{ width: `${VIEW}px`, height: `${VIEW}px` }"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="drag = null"
      @pointercancel="drag = null"
      @wheel.prevent="setZoom(zoom - Math.sign($event.deltaY) * 0.1)"
      @keydown="key"
    >
      <img ref="img" :src="src" alt="" draggable="false" :style="imgStyle" @load="loaded">
    </div>

    <!-- 缩放 -->
    <div class="crop-zoom">
      <span aria-hidden="true">缩放</span>
      <Slider :model-value="zoom" :min="1" :max="4" label="缩放" :disabled="!size" @update:model-value="setZoom" />
    </div>

    <!-- 操作区 -->
    <div class="actions">
      <button class="btn primary" type="button" :disabled="!size" @click="crop">用这张</button>
      <button class="btn" type="button" @click="dialog.close()">取消</button>
    </div>
  </dialog>
</template>
