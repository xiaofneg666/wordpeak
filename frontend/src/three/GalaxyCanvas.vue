<script setup>
import { ref, watch, onMounted, onUnmounted, onActivated, onDeactivated, toRaw } from 'vue'
import { useUniverse } from '../stores/universe'
import { GalaxyEngine } from './galaxy/engine.js'

// 薄壳组件:持有引擎生命周期 + store → 引擎数据同步(一律 toRaw 防 Proxy 泄入 three)
// 监听词根标签点击事件 → 打开 FamilyView
const store = useUniverse()
const containerEl = ref(null)
let engine = null

function onLabelClick(e) {
  store.openFamily(e.detail)
}
// WordPanel 例句滚动 → 3D 点亮当前句中的星球(engine 自校验 selectedId,迟到事件无害)
function onExampleActive(e) {
  engine?.setActiveExample(e.detail?.index ?? -1)
}
// 主题切换 → 3D 星系换色(命名函数,卸载时可移除)
function onThemeChange() { engine?.applyTheme() }
// 全局 Esc(帮助面板承诺的「退出家族视角」)→ 解除家族锁定
function onUnlockFamily() { engine?.unlockFamily() }

onMounted(() => {
  engine = new GalaxyEngine(containerEl.value, {
    onSelect: (id) => store.selectWord(id),
  })
  if (store.words.length) {
    engine.build(toRaw(store.words), toRaw(store.states))
    engine.setSelected(store.selectedWordId)
  }
  watch(() => store.words, (w) => {
    if (!engine) return
    engine.build(toRaw(w), toRaw(store.states))
    engine.setSelected(store.selectedWordId)
  })
  watch(() => store.states, (s) => engine?.updateStates(toRaw(s)))
  watch(() => store.selectedWordId, (id) => engine?.setSelected(id))
  window.addEventListener('wv:openFamily', onLabelClick)
  window.addEventListener('wv:exampleactive', onExampleActive)
  window.addEventListener('wv:themechange', onThemeChange)
  window.addEventListener('wv:unlockFamily', onUnlockFamily)
})

// KeepAlive 缓存下切走圣殿不再卸载:渲染循环必须手动停,否则 3D 在后台空烧 WebGL
let loopPaused = false
onDeactivated(() => {
  if (!engine) return
  engine.renderer.setAnimationLoop(null)
  loopPaused = true
})
onActivated(() => {
  if (!engine || !loopPaused) return
  engine.renderer.setAnimationLoop(engine._tick)
  loopPaused = false
})

onUnmounted(() => {
  window.removeEventListener('wv:openFamily', onLabelClick)
  window.removeEventListener('wv:exampleactive', onExampleActive)
  window.removeEventListener('wv:themechange', onThemeChange)
  window.removeEventListener('wv:unlockFamily', onUnlockFamily)
  engine?.dispose()
  engine = null
})
</script>

<template>
  <div ref="containerEl" class="galaxy-canvas" />
</template>
