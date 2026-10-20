<script setup>
// 领地星座徽记:跟随当前 .terr-head 右缘的小型 Three.js 画布
// 与 AmbientField 共用 three chunk;WebGL 不可用时随 ambientFailed 一起不出现
import { ref, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({ view: { type: String, required: true } })

const cvs = ref(null)
let engine = null
let destroyed = false

onMounted(async () => {
  try {
    const { TerritoryMark } = await import('../three/ambient/TerritoryMark.js')
    if (destroyed || !cvs.value) return
    engine = new TerritoryMark(cvs.value, { view: props.view })
    if (!engine.ok) { engine = null; return }
  } catch (e) {
    console.error('[WordPeak] 领地星图启动失败:', e)
    engine = null
  }
})

watch(() => props.view, (v) => {
  engine?.setView(v)
  // 视图切换有 320ms 过场掩护,等新页头挂进 DOM 后再对位
  setTimeout(() => engine?.syncAnchor(), 380)
  setTimeout(() => engine?.syncAnchor(), 900)
})

onUnmounted(() => {
  destroyed = true
  engine?.dispose()
  engine = null
})
</script>

<template>
  <canvas ref="cvs" class="territory-mark" width="280" height="210" aria-hidden="true" />
</template>

<style scoped>
.territory-mark {
  position: fixed; left: 0; top: 0;
  width: 280px; height: 210px;
  z-index: 2; pointer-events: none;
  opacity: 0;
  transition: opacity 0.45s var(--ease);
  will-change: transform, opacity;
}
@media (max-width: 940px) { .territory-mark { display: none } }
</style>
