<script setup>
import { computed } from 'vue'

// 统一空态:一个大号文字(一两个汉字,如"空""还没有") + 引导文案 + 主操作按钮 slot
// icon 传字符串;旧的 emoji prop 仍兼容,作为兜底
const props = defineProps({
  icon: { type: String, default: '' },
  emoji: { type: String, default: '' },
  title: { type: String, required: true },
  desc: { type: String, default: '' },
  // 紧凑模式(嵌在卡片内部的小空态)
  compact: { type: Boolean, default: false },
})

const glyph = computed(() => props.icon || props.emoji || '')
// 按字数给字号:一个字放最大,两个字稍收,三个及以上当成一行短语
const glyphSize = computed(() => {
  const n = glyph.value.length
  return n <= 1 ? 'l1' : n === 2 ? 'l2' : 'l3'
})
</script>

<template>
  <div class="empty-state-card dots-host" :class="{ compact }">
    <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.25" />
    <div v-if="glyph" class="esc-glyph" :class="glyphSize">{{ glyph }}</div>
    <div class="esc-title">{{ title }}</div>
    <p v-if="desc" class="esc-desc">{{ desc }}</p>
    <div v-if="$slots.default" class="esc-action">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-state-card {
  position: relative;
  text-align: center;
  padding: 44px 20px;
  color: var(--text-3);
  animation: riseIn 0.4s var(--ease) both;
}
.empty-state-card.compact { padding: 22px 12px; }
/* 空态不是「什么都没有」:一层淡淡的星尘点阵垫在图标后面;
   紧凑模式(嵌在卡片里)空间不够,不铺点阵 */
.empty-state-card.compact .dots-decor { display: none; }

/* 大号文字:细淡的渐变字,像水印;hover 时统一呼吸(微亮微浮,慢循环) */
.esc-glyph {
  font-weight: 800; line-height: 1.1;
  background: var(--grad-text); background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  -webkit-text-fill-color: transparent;
  opacity: 0.45;
  margin-bottom: 14px;
  transition: opacity 0.4s var(--ease-out-3), transform 0.4s var(--ease-out-3);
}
.empty-state-card:hover .esc-glyph {
  animation: escBreath 2.8s var(--ease-in-out-3) infinite;
}
@keyframes escBreath {
  0%, 100% { opacity: 0.45; transform: translateY(0); }
  50% { opacity: 0.7; transform: translateY(-3px); }
}
.esc-glyph.l1 { font-size: 56px; letter-spacing: 0.05em; }
.esc-glyph.l2 { font-size: 40px; letter-spacing: 0.3em; }
.esc-glyph.l3 { font-size: var(--fs-xl); letter-spacing: 0.35em; }
.empty-state-card.compact .esc-glyph.l1 { font-size: 38px; margin-bottom: 8px; }
.empty-state-card.compact .esc-glyph.l2 { font-size: var(--fs-2xl); margin-bottom: 8px; }
.empty-state-card.compact .esc-glyph.l3 { font-size: var(--fs-md); margin-bottom: 8px; }

.esc-title {
  font-size: var(--fs-md); font-weight: 600; color: var(--text-2);
  letter-spacing: -0.01em;
}
.empty-state-card.compact .esc-title { font-size: var(--fs-sm); }
.esc-desc {
  font-size: var(--fs-sm); line-height: 1.8; color: var(--text-3);
  max-width: 420px; margin: 8px auto 0;
}
.empty-state-card.compact .esc-desc { font-size: var(--fs-xs); margin-top: 4px; }
.esc-action {
  margin-top: 18px;
  display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;
}
.empty-state-card.compact .esc-action { margin-top: 12px; }
</style>
