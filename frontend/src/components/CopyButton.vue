<script setup>
import { copyText } from '../utils/wordText.js'
import { message } from '../ui.js'

const props = defineProps({
  text: { type: String, default: '' },
  // 按钮文案;留空则不显示文字(纯图标)
  label: { type: String, default: '' },
  // 图标:'copy' | 'link' | 'ipa'(决定 svg)
  icon: { type: String, default: 'copy' },
  // 复制成功/失败提示文案
  ok: { type: String, default: '已复制到剪贴板' },
  fail: { type: String, default: '复制失败,请手动选择' },
  // 样式尺寸:'sm' | 'md'
  size: { type: String, default: 'sm' },
  title: { type: String, default: '' },
})

async function onClick() {
  if (!props.text) return
  const ok = await copyText(props.text)
  if (ok) message.success(props.ok)
  else message.error(props.fail)
}
</script>

<template>
  <button
    class="copy-btn" :class="size"
    :title="title || label || ok"
    @click.stop="onClick"
  >
    <!-- copy 图标 -->
    <svg v-if="icon === 'copy'" class="ic" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
    <!-- 分享/链接图标 -->
    <svg v-else-if="icon === 'link'" class="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 1 0-7.07-7.07l-1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
    <!-- 音标/口形图标 -->
    <svg v-else-if="icon === 'ipa'" class="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <path d="M8 8c0-2.2 1.8-4 4-4s4 1.8 4 4-1.8 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <path d="M6 21c0-3.3 2.7-6 6-6s6 2.7 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
    <span v-if="label" class="copy-btn-label">{{ label }}</span>
  </button>
</template>

<style scoped>
.copy-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px; border-radius: 8px;
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text-2); font-size: var(--fs-xs); font-family: inherit;
  cursor: pointer;
  transition: all 0.18s var(--ease);
}
.copy-btn.md { padding: 7px 13px; font-size: var(--fs-sm); }
.copy-btn:hover { color: var(--text); border-color: var(--line-accent); background: var(--surface-hover); }
.copy-btn:active { transform: translateY(1px); }
.copy-btn .ic { width: 13px; height: 13px; flex-shrink: 0; }
.copy-btn.md .ic { width: 15px; height: 15px; }
</style>
