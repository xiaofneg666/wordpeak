<script setup>
// 学习舱 · 幕二「回忆」:材料全部收走,只剩词和发音。
// 认知科学依据:
//   - 主动回忆(active retrieval)比重读记得牢得多(测试效应,Roediger & Karpicke)
//   - 合意困难:先想 ~10 秒再翻面,挣扎着提取的记忆痕迹更深(Bjork)
//   - 元认知自评(认识/模糊/不认识)比四选一更能校准记忆状态,直接映射 FSRS 等级入库
// 自评 → store.api_submitReview(wordId, correct, ms, selfGrade) 走真实 FSRS 调度。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { speak } from '../../speech.js'
import { useUniverse } from '../../stores/universe'

const props = defineProps({
  word: { type: Object, required: true },
})
const emit = defineEmits(['next', 'graded'])
const store = useUniverse()

const THINK_SECONDS = 10
const phase = ref('think')       // think(倒计时想) → reveal(翻面自评) → feedback(FSRS 反馈)
const remainMs = ref(THINK_SECONDS * 1000)
const startedAt = Date.now()
let timer = null

onMounted(() => {
  speak(props.word.word)
  timer = setInterval(() => {
    remainMs.value = Math.max(0, remainMs.value - 100)
    if (remainMs.value <= 0) clearInterval(timer)
  }, 100)
})
onUnmounted(() => clearInterval(timer))

const RADIUS = 30
const CIRC = 2 * Math.PI * RADIUS
const dashOffset = computed(() => CIRC * (1 - remainMs.value / (THINK_SECONDS * 1000)))
const secondsLeft = computed(() => Math.ceil(remainMs.value / 1000))
const canReveal = computed(() => remainMs.value <= 0)

function reveal() {
  clearInterval(timer)
  phase.value = 'reveal'
}

const SUBMITTING = ref(false)
const result = ref(null)
const selfPicked = ref(null)

async function selfGrade(kind) {
  if (SUBMITTING.value) return
  SUBMITTING.value = true
  selfPicked.value = kind
  const correct = kind !== 'unknown'
  try {
    result.value = await store.api_submitReview(props.word.id, correct, Date.now() - startedAt, kind)
  } catch { result.value = null }
  SUBMITTING.value = false
  phase.value = 'feedback'
  if (kind === 'known') {
    emit('graded', kind)
    // 3D 星系联动:点亮这颗星(圣殿里当场亮一档)
    window.dispatchEvent(new CustomEvent('wv:wordLit', { detail: { wordId: props.word.id } }))
  } else {
    emit('graded', kind)
  }
}

// FSRS 反馈文案:把"为什么是这个间隔"讲给用户听(数据来自后端,前端只渲染不复算)
const feedbackLine = computed(() => {
  const r = result.value
  if (!r) return '这一评已记入你的记忆档案'
  const days = r.next_interval_days ?? r.interval_days
  const pct = Math.round((r.predicted_retention ?? 0.9) * 100)
  if (selfPicked.value === 'unknown') {
    return `没关系——它的记忆稳定性刚被重置,今天就会再排给你。别急着消灭它,多见几次就熟了`
  }
  const d = days >= 1 ? `约 ${Math.max(1, Math.round(days))} 天后` : '今天稍后'
  return `${d}再见到它——到那天你大概还剩 ${pct}% 的记忆,复习刚好卡在遗忘之前`
})
</script>

<template>
  <section class="learn-act lr-act">
    <!-- 回忆阶段:只剩词,10 秒倒计时环 -->
    <div v-if="phase === 'think'" class="lr-think">
      <div class="lr-kicker">第二幕 · 回忆 · 只靠你自己</div>
      <!-- 词逐字凝出:这一幕它独自悬在黑暗里,你的记忆是唯一的光源 -->
      <BlurText :text="word.word" as="h2" class="lr-word" :stagger="55" />
      <button class="lr-speak" @click="speak(word.word)" title="再听一遍发音">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M11 5 6 9H3v6h3l5 4V5z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7M18.3 5.7a9 9 0 0 1 0 12.6"/></svg>
        再听一遍
      </button>
      <div class="lr-timer" :class="{ done: canReveal }">
        <svg viewBox="0 0 72 72" width="72" height="72" aria-hidden="true">
          <circle class="lr-ring-bg" cx="36" cy="36" :r="RADIUS" />
          <circle class="lr-ring" cx="36" cy="36" :r="RADIUS" :stroke-dasharray="CIRC.toFixed(2)" :stroke-dashoffset="dashOffset.toFixed(2)" />
        </svg>
        <span class="lr-timer-num">{{ secondsLeft }}</span>
      </div>
      <p class="lr-hint">先别翻面——努力想它的意思。想 10 秒费劲想起来的,记得最牢</p>
      <button class="btn ghost lr-reveal-btn" :disabled="!canReveal" @click="reveal">
        {{ canReveal ? '翻面 · 看释义,给自己评分' : `努力回忆中…（也可以提前翻面）` }}
      </button>
      <button v-if="!canReveal" class="lr-skip" @click="reveal">想起来了,提前翻面</button>
    </div>

    <!-- 翻面:释义 + 三档自评 -->
    <div v-else-if="phase === 'reveal'" class="lr-reveal">
      <div class="lr-kicker">它是这个意思 —— 你刚才想起来了吗</div>
      <BlurText :text="word.word" as="h2" class="lr-word" :stagger="40" />
      <div class="lr-rule" aria-hidden="true" />
      <p class="lr-meaning">{{ word.meaning }}</p>
      <p class="lr-ety">{{ word.etymology }}</p>
      <div class="lr-selves">
        <button class="self-btn known" :disabled="SUBMITTING" @click="selfGrade('known')">
          <span class="self-label">认识</span>
          <span class="self-desc">秒懂,毫不费力</span>
        </button>
        <button class="self-btn fuzzy" :disabled="SUBMITTING" @click="selfGrade('fuzzy')">
          <span class="self-label">模糊</span>
          <span class="self-desc">想了一会儿 / 不太确定</span>
        </button>
        <button class="self-btn unknown" :disabled="SUBMITTING" @click="selfGrade('unknown')">
          <span class="self-label">不认识</span>
          <span class="self-desc">没想起来</span>
        </button>
      </div>
      <p class="lr-calibrate">凭真实感受选——自评越诚实,后面给你安排的复习越准</p>
    </div>

    <!-- 反馈:FSRS 调度解释 -->
    <div v-else class="lr-feedback">
      <!-- 答对时刻 · 就地星点亮仪式:与圣殿 wv:wordLit 同一因果,这一幕里当场看得见 -->
      <div v-if="selfPicked === 'known'" class="lr-lit ritual-lit">
        <span class="lr-lit-star" aria-hidden="true" />
        <span class="lr-lit-text">这颗星为你亮了</span>
      </div>
      <div class="lr-kicker">{{ selfPicked === 'unknown' ? '没关系,这很正常' : '已记入记忆档案' }}</div>
      <p class="lr-feedback-line">{{ feedbackLine }}</p>
      <button class="btn primary lr-next" @click="emit('next')">
        {{ selfPicked === 'unknown' ? '再看一眼编码,然后巩固' : '进入巩固 · 拼一遍再走' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.lr-act { max-width: 620px; margin: 0 auto; text-align: center; }
.lr-kicker { font-size: var(--fs-2xs); letter-spacing: 0.32em; color: var(--text-3); margin-bottom: 18px; animation: terrRise 0.5s var(--ease) 0.05s backwards; }
/* 词交给 BlurText 逐字凝出,容器自身入场动画置空 */
.lr-word {
  font-family: var(--serif);
  font-size: clamp(46px, 8vw, 70px); font-weight: 600; color: var(--text); line-height: 1.15;
  /* 词是这一幕的星名:独自悬在黑暗里,自带一点暖金——与三幕大词同一语言 */
  text-shadow: 0 0 36px color-mix(in srgb, var(--gold) 22%, transparent);
}
.lr-speak {
  display: inline-flex; align-items: center; gap: 7px; margin-top: 14px;
  background: none; border: 1px solid var(--line); border-radius: 999px;
  color: var(--text-2); font-size: var(--fs-xs); padding: 5px 14px; cursor: pointer;
  transition: all .18s var(--ease);
}
.lr-speak:hover { color: var(--accent); border-color: var(--line-accent); transform: translateY(-2px); }

.lr-timer { position: relative; width: 72px; height: 72px; margin: 28px auto 14px; }
/* 冥想阶段的级联:词凝出后,呼吸环→提示→按钮逐级浮现 */
.lr-think .lr-speak { animation: terrRise 0.5s var(--ease) 0.2s backwards; }
.lr-think .lr-timer { animation: terrRise 0.5s var(--ease) 0.26s backwards; }
.lr-think .lr-hint { animation: terrRise 0.5s var(--ease) 0.34s backwards; }
.lr-think .lr-reveal-btn { animation: terrRise 0.45s var(--ease) 0.42s backwards; }
.lr-think .lr-skip { animation: terrRise 0.45s var(--ease) 0.5s backwards; }
.lr-ring-bg { fill: none; stroke: var(--line); stroke-width: 2.5; }
.lr-ring { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke 0.4s var(--ease); }
.lr-timer.done .lr-ring { stroke: var(--success); }
.lr-timer-num {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-family: var(--mono); font-size: var(--fs-lg); color: var(--text-2); font-variant-numeric: tabular-nums;
}
.lr-hint { font-size: var(--fs-sm); color: var(--text-3); margin: 18px auto 20px; max-width: 420px; line-height: 1.7; }
.lr-reveal-btn { font-size: var(--fs-base); padding: 9px 24px; }
.lr-skip { margin-top: 12px; background: none; border: none; font-size: var(--fs-xs); color: var(--text-3); cursor: pointer; text-decoration: underline dotted; text-underline-offset: 4px; }
.lr-skip:hover { color: var(--text-2); }

/* 翻面是"揭幕":释义→词源→三档自评→校准语,逐级升起(此前后三行是瞬切) */
.lr-reveal .lr-rule { width: 46px; height: 1.5px; background: var(--accent); opacity: 0.7; margin: 16px auto; animation: terrRise 0.45s var(--ease) 0.16s backwards; }
.lr-reveal .lr-meaning { font-size: var(--fs-xl); color: var(--text); animation: terrRise 0.5s var(--ease) 0.22s backwards; }
.lr-reveal .lr-ety {
  font-size: var(--fs-base); color: var(--text-3); margin-top: 8px;
  font-family: var(--serif);
  animation: terrRise 0.5s var(--ease) 0.3s backwards;
}
.lr-reveal .lr-selves { animation: terrRise 0.5s var(--ease) 0.4s backwards; }
.lr-reveal .lr-calibrate { animation: terrRise 0.45s var(--ease) 0.52s backwards; }

.lr-selves { display: flex; justify-content: center; gap: 12px; margin: 30px 0 14px; flex-wrap: wrap; }
.self-btn {
  flex: 1; min-width: 150px; max-width: 200px;
  display: flex; flex-direction: column; gap: 4px; align-items: center; padding: 14px 10px;
  background: var(--surface); border: 1.5px solid var(--line); border-radius: 12px;
  cursor: pointer; transition: border-color .18s var(--ease), transform .18s var(--ease), background .18s var(--ease), box-shadow .18s var(--ease);
}
/* 自评卡对齐全站升起:-3px + shadow-md(在这里下的是判断,给足台面) */
.self-btn:hover { transform: translateY(-3px); box-shadow: var(--shadow-md); }
.self-btn:disabled { opacity: 0.6; cursor: wait; }
.self-label { font-size: var(--fs-lg); font-weight: 600; color: var(--text); letter-spacing: 0.12em; }
.self-desc { font-size: var(--fs-2xs); color: var(--text-3); }
/* 三档语义色走 token(暖夜下自动换粉彩,与终幕统计同源) */
.self-btn.known:hover, .self-btn.known.picked { border-color: var(--success); background: color-mix(in srgb, var(--success) 9%, var(--surface)); }
.self-btn.fuzzy:hover, .self-btn.fuzzy.picked { border-color: var(--warn); background: color-mix(in srgb, var(--warn) 9%, var(--surface)); }
.self-btn.unknown:hover, .self-btn.unknown.picked { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 9%, var(--surface)); }
.lr-calibrate { font-size: var(--fs-xs); color: var(--text-3); }

.lr-feedback-line {
  font-size: var(--fs-md); color: var(--text-2); line-height: 1.8; max-width: 460px; margin: 0 auto 26px;
  animation: terrRise 0.5s var(--ease) 0.08s backwards;
}
.lr-next { font-size: var(--fs-md); padding: 10px 26px; animation: terrRise 0.45s var(--ease) 0.28s backwards; }
/* 星点亮仪式:金四芒星 + halo(与暗物质区 dm-lit 同一语言) */
.lr-lit {
  display: inline-flex; align-items: center; gap: 10px;
  margin: 0 auto 20px; padding: 8px 18px;
  border: 1px solid color-mix(in srgb, var(--gold) 35%, transparent);
  border-radius: 999px; color: var(--gold);
  animation: terrRise 0.45s var(--ease) backwards, starFlare 1.2s var(--ease) 0.2s 1;
}
[data-theme='light'] .lr-lit {
  animation: terrRise 0.45s var(--ease) backwards, starFlareLight 1.2s var(--ease) 0.2s 1;
}
.lr-lit-star {
  width: 12px; height: 12px; background: var(--gold);
  clip-path: polygon(50% 0, 58% 42%, 100% 50%, 58% 58%, 50% 100%, 42% 58%, 0 50%, 42% 42%);
  /* 原硬编码奶油色光晕换金令牌:四主题下 halo 跟着各自的金走 */
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--gold) 50%, transparent));
}
[data-theme='light'] .lr-lit-star { filter: none; }
.lr-lit-text { font-size: var(--fs-xs); letter-spacing: 0.14em; }

@media (max-width: 640px) {
  .self-btn { min-width: 100%; }
}
</style>
