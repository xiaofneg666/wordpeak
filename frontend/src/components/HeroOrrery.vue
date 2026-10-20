<script setup>
// 观星台首屏的实时天体仪:Three.js 行星 + 尘埃环 + 卫星
// three.js 仍走动态 import —— Dashboard 是首屏同步视图,不能把 505KB 拖进关键路径
import { ref, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'

const cvs = ref(null)
let engine = null
let dead = false
let deactivated = false

onMounted(async () => {
  try {
    const { HeroOrrery } = await import('../three/ambient/HeroOrrery.js')
    if (dead || !cvs.value) return
    engine = new HeroOrrery(cvs.value)
    if (deactivated) engine.setActive(false)
  } catch (e) {
    console.error('[WordPeak] 天体仪启动失败:', e)
  }
})

onActivated(() => {
  deactivated = false
  engine?.setActive(true)
  engine?.resize()
})
onDeactivated(() => {
  deactivated = true
  engine?.setActive(false)
})
onUnmounted(() => {
  dead = true
  engine?.dispose()
  engine = null
})
</script>

<template>
  <canvas ref="cvs" class="hero-orrery" width="320" height="210" aria-hidden="true" />
</template>

<style scoped>
.hero-orrery { display: block; height: auto; }
</style>
