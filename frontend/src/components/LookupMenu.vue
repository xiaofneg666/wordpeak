<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { copyText } from '../utils/wordText.js'
import { message } from '../ui.js'

const props = defineProps({
  word: { type: String, required: true },
  ipa: { type: String, default: '' },
  size: { type: String, default: 'sm' }, // 'sm' | 'md'
})

const open = ref(false)
const wrapRef = ref(null)

// 词典菜单项:中文 + 英文站点都放,首次点击任意项后弹窗默认不拦截
const items = computed(() => {
  const w = props.word
  return [
    { key: 'youdao', label: '有道词典',   url: `https://www.youdao.com/w/eng/${encodeURIComponent(w)}` },
    { key: 'google', label: 'Google 翻译', url: `https://translate.google.com/?sl=en&tl=zh-CN&text=${encodeURIComponent(w)}` },
    { key: 'bing',   label: '必应词典',   url: `https://cn.bing.com/dict/search?q=${encodeURIComponent(w)}` },
  ]
})

function openMenu() { open.value = !open.value }
function pickItem(item) {
  window.open(item.url, '_blank', 'noopener,noreferrer')
  open.value = false
}

async function copyIpa() {
  if (!props.ipa) return
  const ok = await copyText(props.ipa)
  if (ok) message.success('音标已复制')
  else message.error('复制失败')
  open.value = false
}

// 点击外部收起
function onPointerDown(e) {
  if (!open.value) return
  if (wrapRef.value && !wrapRef.value.contains(e.target)) open.value = false
}
onMounted(() => document.addEventListener('pointerdown', onPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown))
</script>

<template>
  <div ref="wrapRef" class="lookup-menu">
    <button class="lookup-trigger" :class="size" :title="`查询 / 复制「${word}」`" @click.stop="openMenu">
      <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="1.8" />
        <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </svg>
      <span v-if="size === 'md'" class="lbl">查询</span>
    </button>
    <Transition name="lm-fade">
      <div v-if="open" class="lookup-panel" role="menu">
        <button v-for="it in items" :key="it.key" class="lm-item" role="menuitem" @click.stop="pickItem(it)">
          <span class="lm-dot" />
          {{ it.label }}
        </button>
        <div class="lm-sep" />
        <button v-if="ipa" class="lm-item" role="menuitem" @click.stop="copyIpa">
          <span class="lm-dot ipa-dot" />
          复制音标 <span class="ipa-preview">{{ ipa }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.lookup-menu { position: relative; display: inline-flex; }
.lookup-trigger {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px; border-radius: 8px;
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text-2); font-size: var(--fs-xs); font-family: inherit;
  cursor: pointer; transition: all 0.18s var(--ease);
}
.lookup-trigger.md { padding: 7px 13px; font-size: var(--fs-sm); }
.lookup-trigger:hover { color: var(--text); border-color: var(--line-accent); background: var(--surface-hover); }
.lookup-trigger .ic { width: 13px; height: 13px; }
.lookup-trigger.md .ic { width: 15px; height: 15px; }

.lookup-panel {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 30;
  min-width: 180px; padding: 6px;
  background: var(--surface); border: 1px solid var(--line-strong);
  border-radius: 10px; box-shadow: 0 12px 32px color-mix(in srgb, var(--bg) 50%, transparent);
  display: flex; flex-direction: column; gap: 2px;
}
.lm-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 7px;
  background: transparent; border: 0; color: var(--text);
  font-size: var(--fs-sm); font-family: inherit; text-align: left;
  cursor: pointer; transition: background 0.15s var(--ease);
}
.lm-item:hover { background: var(--surface-hover); }
.lm-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
.lm-dot.ipa-dot { background: var(--accent-2); }
.ipa-preview { margin-left: auto; font-family: var(--mono); color: var(--text-3); font-size: var(--fs-xs); }
.lm-sep { height: 1px; background: var(--line); margin: 4px 6px; }

.lm-fade-enter-active, .lm-fade-leave-active { transition: opacity 0.15s var(--ease), transform 0.15s var(--ease); }
.lm-fade-enter-from, .lm-fade-leave-to { opacity: 0; transform: translateY(-4px); }
</style>