<script setup>
// 领地环境层(Territory Scene):每个领地只留一笔极轻的领地色光(单侧低角度 radial wash)
// 用户反馈「白了看不清/乱」后做了减法:巨号 ghost 水印字已整体删除(文字可读性 > 氛围),
// 晴空主题依然整层不渲染 —— 白天看不见星星,色光在白底上也只会显脏
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({ view: { type: String, required: true } })

const light = ref(false)
function readTheme() {
  light.value = document.documentElement.getAttribute('data-theme') === 'light'
}
onMounted(() => {
  readTheme()
  window.addEventListener('wv:themechange', readTheme)
})
onUnmounted(() => window.removeEventListener('wv:themechange', readTheme))

// hue 用现有主题令牌(不发明新颜色);mistakes 不给光(黑暗即内容)
const SCENES = {
  dashboard:   { hue: 'var(--accent)',   pos: 'tr' },
  listening:   { hue: 'var(--accent)',   pos: 'tr' },
  reading:     { hue: 'var(--success)',  pos: 'bl' },
  speaking:    { hue: 'var(--accent-2)', pos: 'tl' },
  writing:     { hue: 'var(--accent-3)', pos: 'br' },
  grammar:     { hue: 'var(--info)',     pos: 'bl' },
  phonetics:   { hue: 'var(--warn)',     pos: 'tr' },
  mistakes:    { hue: null,              pos: 'br' },
  bookshelf:   { hue: 'var(--success)',  pos: 'tl' },
  collections: { hue: 'var(--accent)',   pos: 'br' },
  tips:        { hue: 'var(--accent)',   pos: 'tl' },
  diary:       { hue: 'var(--accent-2)', pos: 'tr' },
  family:      { hue: 'var(--accent-2)', pos: 'bl' },
}
const scene = computed(() => (light.value ? null : SCENES[props.view] || null))
</script>

<template>
  <Transition name="ts-fade" mode="out-in">
    <div
      v-if="scene" :key="view"
      class="ts" :class="`ts-${scene.pos}`"
      :style="{ '--ts-hue': scene.hue || 'transparent' }"
      aria-hidden="true"
    >
      <div v-if="scene.hue" class="ts-wash" />
    </div>
  </Transition>
</template>

<style scoped>
.ts {
  position: fixed; inset: 0; z-index: 0;
  pointer-events: none; overflow: hidden;
}
/* 领地光:单侧低角度色光,像这个领地自己的月色(不是全场提亮,不压文字) */
.ts-wash {
  position: absolute; inset: 0;
  background: radial-gradient(
    1100px 720px at var(--wx, 18%) var(--wy, 6%),
    color-mix(in srgb, var(--ts-hue) 4.5%, transparent),
    transparent 70%
  );
}
.ts-tr .ts-wash { --wx: 78%; --wy: 4% }
.ts-tl .ts-wash { --wx: 12%; --wy: 6% }
.ts-bl .ts-wash { --wx: 8%; --wy: 92% }
.ts-br .ts-wash { --wx: 88%; --wy: 90% }

/* 换幕:0.55s 交叉淡入(领地过场盖住前 320ms,观众只看到尾段) */
.ts-fade-enter-active, .ts-fade-leave-active { transition: opacity 0.55s var(--ease) }
.ts-fade-enter-from, .ts-fade-leave-to { opacity: 0 }
</style>
