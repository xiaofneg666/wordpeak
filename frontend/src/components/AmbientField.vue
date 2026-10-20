<script setup>
// 全站环境天空:Three.js 共享背景层(深度星野 + 星云 + 每领地星座)
// three.js 走动态 import —— 首屏先用 CSS 底色与页面内容,环境层在挂载后异步就绪,
// 不把 505KB 的 three 拖进首屏关键路径(与 Onboarding 的懒加载同理)
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({ view: { type: String, required: true } })
const emit = defineEmits(['fail'])

const cvs = ref(null)
const hidden = computed(() => props.view === 'galaxy' || props.view === 'site')
let engine = null
let destroyed = false

onMounted(async () => {
  try {
    const { AmbientSky } = await import('../three/ambient/AmbientSky.js')
    if (destroyed || !cvs.value) return
    engine = new AmbientSky(cvs.value, { onFail: () => emit('fail') })
    if (!engine.ok) { emit('fail'); return }
    engine.setView(props.view)
    engine.setActive(!hidden.value)
  } catch (e) {
    console.error('[WordPeak] 环境天空启动失败:', e)
    emit('fail')
  }
})

watch(() => props.view, (v) => {
  if (!engine?.ok) return
  engine.setView(v)
  engine.setActive(v !== 'galaxy' && v !== 'site')
})

onUnmounted(() => {
  destroyed = true
  engine?.dispose()
  engine = null
})
</script>

<template>
  <!-- 圣殿与官网自带整片 3D 场景:这两页让环境层歇着,别白烧一个 WebGL 上下文 -->
  <canvas v-show="!hidden" ref="cvs" class="ambient-sky" aria-hidden="true" />
</template>

<style scoped>
.ambient-sky {
  position: fixed; inset: 0; z-index: 0;
  width: 100vw; height: 100vh;
  pointer-events: none;
}
</style>
