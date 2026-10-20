<script setup>
// 逐字模糊入场(motion-primitives · Blur Text 零依赖复刻)
// 全局注册(main.js),任何视图直接 <BlurText text="回声谷" as="h2" />:
// 逐字 blur(10px)→0 + 上浮,按 --ease-out-4 解焦;prefers-reduced-motion
// 直接平铺文本。衬线领地名等 3~6 字的短标题最出效果,长句别用。
import { computed } from 'vue'

const props = defineProps({
  text: { type: String, required: true },
  // 外层标签:h1/h2/span…(样式继承自真实标签,组件只加动画)
  as: { type: String, default: 'span' },
  // 每字延迟(ms),默认 45;标题越长可越小
  stagger: { type: Number, default: 45 },
})

const reduced = typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches

const chars = computed(() => [...props.text])
</script>

<template>
  <component :is="as" class="blur-text" :aria-label="text">
    <template v-if="reduced">{{ text }}</template>
    <span
      v-for="(c, i) in chars"
      v-else
      :key="i"
      class="blur-ch"
      aria-hidden="true"
      :style="{ animationDelay: `${i * stagger}ms` }"
    >{{ c === ' ' ? '\u00A0' : c }}</span>
  </component>
</template>
