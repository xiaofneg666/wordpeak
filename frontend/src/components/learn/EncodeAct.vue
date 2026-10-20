<script setup>
// 学习舱 · 幕一「编码」:把记忆材料一次性铺开——词根拆解 / 词源故事 / 谐音联想 / 语境例句。
// 认知科学依据:
//   - 形态学拆词训练让词汇习得提速约 2.3 倍(Nation 词根法研究)
//   - 关键词谐音图像法(keyword method)提升回忆率约 77%(Atkinson 双重编码)
//   - 语境相遇 10-20 次才能长牢(语境学习优于孤立列表,约 3 倍保持率)
// 幕尾明确告知「材料会被收走」,引导用户在这一幕认真加工。
import { computed, onMounted } from 'vue'
import { speak } from '../../speech.js'

const props = defineProps({
  word: { type: Object, required: true },
  rootStory: { type: Object, default: null },
})
const emit = defineEmits(['next'])

// etymology 形如 "in-(进入) + spect(看) → 往里仔细看 → 检查":
// 第一段按 + 切成 morpheme 芯片,其余段是释义链
const flow = computed(() => {
  const ety = props.word.etymology || ''
  const parts = ety.split('→').map((s) => s.trim()).filter(Boolean)
  const first = parts.shift() || ''
  const morphs = first.includes('+')
    ? first.split('+').map((s) => s.trim()).filter(Boolean)
    : null
  return { morphs, chain: parts }
})

// 谐音/图像通道:mnemonic 字段未落地时整块跳过(不占位不破版)
const hasMnemonic = computed(() => !!props.word.mnemonic)

onMounted(() => { speak(props.word.word) })
</script>

<template>
  <!-- cascade:词头→各通道→收尾逐级升起(运动第二定律:一切入场有级联) -->
  <section class="learn-act cascade">
    <!-- 词头:衬线大字 + 音标 + 词性 -->
    <header class="la-head">
      <div class="la-kicker">第一幕 · 编码 · 先建立联结</div>
      <!-- 词从暗物质里逐字显形:编码,就是让这个词第一次被看见 -->
      <BlurText :text="word.word" as="h2" class="la-word" :stagger="55" />
      <div class="la-meta">
        <span class="la-ipa">{{ word.ipa }}</span>
        <span class="la-pos">{{ word.pos }}</span>
        <button class="la-speak" @click="speak(word.word)" title="读一遍">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M11 5 6 9H3v6h3l5 4V5z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7M18.3 5.7a9 9 0 0 1 0 12.6"/></svg>
        </button>
      </div>
      <div class="la-rule" aria-hidden="true" />
      <p class="la-meaning">{{ word.meaning }}</p>
    </header>

    <!-- 通道一:词根拆解(morpheme 芯片 → 释义链) -->
    <div v-if="flow.morphs || flow.chain.length" class="la-block">
      <div class="la-block-kicker">拆开看 · {{ word.root }}-（{{ word.root_meaning }}）</div>
      <div v-if="flow.morphs" class="morph-row">
        <template v-for="(m, i) in flow.morphs" :key="i">
          <span v-if="i" class="morph-plus">+</span>
          <span class="morph-chip" :style="{ animationDelay: `${0.1 + i * 0.14}s` }">{{ m }}</span>
        </template>
      </div>
      <div v-if="flow.chain.length" class="morph-chain">
        <template v-for="(c, i) in flow.chain" :key="i">
          <span v-if="i" class="morph-arrow">→</span>
          <span class="morph-chain-seg" :style="{ animationDelay: `${0.3 + i * 0.14}s` }">{{ c }}</span>
        </template>
      </div>
    </div>

    <!-- 通道二:词源故事(三段式:起源/分化/辨析) -->
    <div v-if="rootStory?.story" class="la-block">
      <div class="la-block-kicker">这个词根的来历</div>
      <p class="la-story">{{ rootStory.story }}</p>
      <p v-if="rootStory.confuse" class="la-confuse"><span class="la-confuse-tag">易混辨析</span>{{ rootStory.confuse }}</p>
    </div>

    <!-- 通道三:谐音/图像联想 -->
    <div v-if="hasMnemonic" class="la-block">
      <div class="la-block-kicker">换个钩子 · 谐音与画面</div>
      <p class="la-mnemonic">{{ word.mnemonic }}</p>
    </div>

    <!-- 通道四:语境例句(每条带朗读) -->
    <div v-if="word.examples?.length" class="la-block">
      <div class="la-block-kicker">语境里遇见它</div>
      <!-- 左缘刻线 + 衬线斜体:例句是"读到它",不是"看到卡片" -->
      <div
        v-for="(ex, i) in word.examples" :key="i"
        class="la-example"
        :style="{ animationDelay: `${0.3 + i * 0.12}s` }"
      >
        <p class="la-example-en">{{ ex.en }}</p>
        <p class="la-example-zh">{{ ex.zh }}</p>
      </div>
    </div>

    <!-- 高频搭配 -->
    <div v-if="word.collocations?.length" class="la-block">
      <div class="la-block-kicker">常和它一起出现</div>
      <p class="la-colloc">
        <span v-for="(c, i) in word.collocations" :key="i" class="la-colloc-item">{{ c.en }}<i>{{ c.zh }}</i></span>
      </p>
    </div>

    <div class="la-foot">
      <p class="la-hint-mono">接下来这些材料会被收走 —— 现在多看一眼,马上让你自己回忆</p>
      <button class="btn primary la-next" @click="emit('next')">我记好了，进入回忆</button>
    </div>
  </section>
</template>

<style scoped>
/* 幕内入场交给全局 .cascade(词头→通道→收尾逐级升起);
   词头内部子元素不再单独 terrRise,避免与级联叠加双重位移 */
.la-head { text-align: center; margin-bottom: 26px; }
.la-kicker { font-size: var(--fs-2xs); letter-spacing: 0.32em; color: var(--text-3); }
.la-word {
  font-family: var(--serif);
  font-size: clamp(44px, 7vw, 64px); font-weight: 600; line-height: 1.15;
  color: var(--text); margin: 10px 0 6px; letter-spacing: 0.01em;
  /* 词是这一幕的星名:与阅读页词卡同款暖金光晕 */
  text-shadow: 0 0 36px color-mix(in srgb, var(--gold) 22%, transparent);
  /* 逐字 BlurText 独占入场 */
}
.la-meta { display: flex; align-items: center; justify-content: center; gap: 12px; }
.la-ipa { font-size: var(--fs-md); color: var(--text-2); font-family: var(--mono); }
.la-pos { font-size: var(--fs-xs); color: var(--text-3); border: 1px solid var(--line); border-radius: 999px; padding: 1px 10px; }
.la-speak {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 999px; border: 1px solid var(--line);
  background: var(--surface); color: var(--text-2); cursor: pointer; transition: all .18s var(--ease);
}
.la-speak:hover { color: var(--accent); border-color: var(--line-accent); transform: translateY(-2px); }
.la-rule { width: 46px; height: 1.5px; background: var(--accent); opacity: 0.7; margin: 14px auto; }
.la-meaning { font-size: var(--fs-lg); color: var(--text); }

/* 通道块 = 资料卡:hairline 边 + sunken 内衬 + r-lg,块间垂直呼吸拉开(20→28)——材料是一块块铺开给你拿走的 */
.la-block {
  margin: 0 0 28px;
  border: 1px solid var(--line); border-radius: var(--r-lg);
  background: var(--surface-sunken); padding: 18px 22px;
}
.la-block-kicker {
  font-size: var(--fs-2xs); letter-spacing: 0.22em; color: var(--text-3); margin-bottom: 10px;
  display: flex; align-items: center; gap: 8px;
}
.la-block-kicker::after { content: ''; flex: 1; height: 1px; background: var(--line); }

.morph-row { display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; }
.morph-plus { color: var(--text-3); font-size: var(--fs-md); }
.morph-chip {
  font-size: var(--fs-md); font-family: var(--serif); color: var(--text);
  border: 1px solid var(--line); border-bottom-color: var(--accent);
  border-radius: 8px; padding: 5px 14px; background: var(--surface);
  animation: terrRise 0.5s var(--ease) backwards;
}
.morph-chain { display: flex; align-items: baseline; justify-content: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
.morph-arrow { color: var(--accent); opacity: 0.8; }
.morph-chain-seg { font-size: var(--fs-lg); color: var(--text-2); animation: terrRise 0.5s var(--ease) backwards; }

.la-story { font-size: var(--fs-md); line-height: 1.85; color: var(--text-2); }
.la-confuse { font-size: var(--fs-base); line-height: 1.8; color: var(--text-3); margin-top: 8px; }
.la-confuse-tag {
  /* 撤掉兜底硬编码 #f472b6:四主题都有 --accent-3,令牌直接生效 */
  font-size: var(--fs-2xs); letter-spacing: 0.18em; color: var(--accent-3);
  margin-right: 10px; border: 1px solid var(--line); border-radius: 999px; padding: 1px 9px;
}
.la-mnemonic {
  font-size: var(--fs-md); line-height: 1.8; color: var(--text);
  border-left: 2px solid var(--accent); padding: 4px 0 4px 16px;
}
/* 例句:左缘 1px 刻线(与信号轨道同源),英文衬线斜体作"阅读声部" */
.la-example {
  border-left: 1px solid var(--line-strong); padding-left: 14px;
  margin-bottom: 14px; animation: terrRise 0.45s var(--ease) backwards;
}
/* 卡内末条例句不再拖一条底距,下缘呼吸交给卡片内衬 */
.la-example:last-child { margin-bottom: 0; }
.la-example-en {
  font-size: var(--fs-md); line-height: 1.65; color: var(--text);
  font-family: var(--serif); font-style: italic;
}
.la-example-zh { font-size: var(--fs-sm); color: var(--text-3); margin-top: 4px; line-height: 1.7; }
.la-colloc { display: flex; flex-wrap: wrap; gap: 10px; }
.la-colloc-item {
  font-size: var(--fs-md); color: var(--text-2); border: 1px solid var(--line);
  border-radius: 999px; padding: 4px 14px; display: inline-flex; flex-direction: column; gap: 1px;
}
.la-colloc-item i { font-style: normal; font-size: var(--fs-xs); color: var(--text-3); }

.la-foot { margin-top: 30px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.la-hint-mono {
  font-size: var(--fs-xs); font-family: var(--mono); color: var(--text-3);
  letter-spacing: 0.08em; text-align: center;
}
.la-next { font-size: var(--fs-md); padding: 10px 26px; }
</style>
