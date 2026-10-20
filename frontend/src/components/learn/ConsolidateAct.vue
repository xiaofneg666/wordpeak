<script setup>
// 学习舱 · 幕三「巩固」:同族词链联想 + 递减线索拼写。
// 认知科学依据:
//   - 词根家族成网络记忆:认识一个根,同族词都变"半熟人"(形态学迁移)
//   - 递减线索拼写(vanishing cues):每次只多给一个字母,主动产出强于被动再认,
//     长期保持率提升约 44%(Fiechter & Benjamin, 2017)
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { speak } from '../../speech.js'
import { useUniverse } from '../../stores/universe'

const props = defineProps({
  word: { type: Object, required: true },
  familyWords: { type: Array, default: () => [] },
})
const emit = defineEmits(['next'])
const store = useUniverse()

// ---- 递减线索拼写:全词亮 3 秒 → 收起 → 输入;卡住点提示,每次只多揭一个字母 ----
const PREVIEW_MS = 3000
const phase = ref('preview') // preview(全词亮 3s) → spell(拼写) → passed
const typed = ref('')
const revealed = ref(0)
let previewTimer = null

onMounted(() => {
  speak(props.word.word)
  previewTimer = setTimeout(() => { phase.value = 'spell' }, PREVIEW_MS)
})
onUnmounted(() => clearTimeout(previewTimer))

const letters = computed(() => (props.word.word || '').split(''))
const masked = computed(() =>
  letters.value.map((c, i) => (i < revealed.value ? c : /[a-zA-Z]/.test(c) ? '·' : c)).join(''))

function hint() {
  // 每点一次,多揭示一个字母(从头往后揭;揭满等于白送,允许——设计上尽量少用)
  if (revealed.value < letters.value.length) revealed.value++
}
function check() {
  if (typed.value.trim().toLowerCase() === (props.word.word || '').toLowerCase()) {
    phase.value = 'passed'
    speak(props.word.word)
  }
}

// 同族词的记忆状态小标(概率语言,与词卡同源)
function stateOf(fw) {
  const s = store.states[fw.id]
  if (!s || s.is_new) return { label: '未学', dim: true }
  const r = s.retrievability ?? s.strength
  return { label: r != null ? `记忆 ${Math.round(r * 100)}%` : '在学', dim: false }
}
const done = computed(() => phase.value === 'passed')
</script>

<template>
  <section class="learn-act lc-act">
    <div class="lc-kicker">第三幕 · 巩固 · 让它挂进网络</div>

    <!-- 同族词链:家族联想 + 各自记忆概率(块间逐级升起) -->
    <div v-if="familyWords.length" class="lc-block" :style="{ animationDelay: '0.12s' }">
      <div class="lc-block-title">和它同根的 {{ familyWords.length }} 个词 —— 认识了 {{ word.root }}-，它们都是半个熟人</div>
      <div class="lc-family">
        <span v-for="fw in familyWords" :key="fw.id" class="lc-fam-chip" @click="store.selectWord(fw.id)">
          <b>{{ fw.word }}</b>
          <i :class="{ dim: stateOf(fw).dim }">{{ stateOf(fw).label }}</i>
        </span>
      </div>
      <p class="lc-fam-hint">点任意一个,可以在词卡里看它的完整档案</p>
    </div>

    <!-- 递减线索拼写 -->
    <div class="lc-block lc-spell" :class="{ passed: done }" :style="{ animationDelay: familyWords.length ? '0.24s' : '0.12s' }">
      <div class="lc-block-title">{{ done ? '拼对了 —— 这个词今天就是你的了' : '趁热拼一遍（先亮 3 秒,然后收走）' }}</div>

      <!-- 预览词逐字凝出:3 秒窗口里,先看清它,再收走 -->
      <BlurText v-if="phase === 'preview'" :text="word.word" as="div" class="lc-preview-word" :stagger="35" />

      <template v-else>
        <div class="lc-mask" :aria-label="`拼这个词,已揭示 ${revealed} 个字母`">{{ masked }}</div>
        <!-- 拼对 = 点亮:金四芒星仪式与回忆幕答对同源,一场学习里两次星点亮 -->
        <div v-if="done" class="lc-lit ritual-lit">
          <span class="lc-lit-star" aria-hidden="true" />
          <span class="lc-lit-text">这个词挂进了你的网络</span>
        </div>
        <div class="lc-spell-row">
          <input
            v-model="typed"
            class="lc-input"
            :class="{ ok: done }"
            type="text"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="凭记忆拼出整个词"
            :disabled="done"
            @keyup.enter="check"
            @input="check"
          />
          <button v-if="!done" class="lc-hint-btn" @click="hint">再给点提示</button>
        </div>
        <p v-if="!done" class="lc-spell-hint">卡住才点提示——每点一次只多亮一个字母,自己拼出来的部分才算数</p>
      </template>
    </div>

    <div class="lc-foot">
      <button class="btn primary lc-next" @click="emit('next')">{{ done ? '下一个词' : '跳过拼写,继续' }}</button>
    </div>
  </section>
</template>

<style scoped>
.lc-act { max-width: 620px; margin: 0 auto; }
.lc-kicker { font-size: var(--fs-2xs); letter-spacing: 0.32em; color: var(--text-3); text-align: center; margin-bottom: 26px; animation: terrRise 0.5s var(--ease) 0.05s backwards; }

/* 块级联:两块先后升起(延迟在模板里按是否有同族块给定);
   卡语言与编码幕 la-block 同款——三幕在同一座舞台上,块要有同一种卡 */
.lc-block {
  margin-bottom: 26px;
  border: 1px solid var(--line); border-radius: var(--r-lg);
  background: var(--surface-sunken); padding: 18px 22px;
  animation: terrRise 0.5s var(--ease) backwards;
}
.lc-block-title { font-size: var(--fs-sm); color: var(--text-2); margin-bottom: 14px; line-height: 1.7; }

.lc-family { display: flex; flex-wrap: wrap; gap: 8px; }
.lc-fam-chip {
  display: inline-flex; flex-direction: column; gap: 2px; cursor: pointer;
  border: 1px solid var(--line); border-radius: 10px; padding: 7px 14px; background: var(--surface);
  transition: border-color .18s var(--ease), transform .18s var(--ease), box-shadow .18s var(--ease);
}
/* 同族词可点进词卡:轻抬 -2px 带一档小影(小 chip 不抢主角戏) */
.lc-fam-chip:hover { border-color: var(--line-accent); transform: translateY(-2px); box-shadow: var(--shadow-sm); }
.lc-fam-chip b { font-size: var(--fs-md); color: var(--text); font-weight: 600; }
.lc-fam-chip i { font-style: normal; font-size: var(--fs-2xs); color: var(--accent); font-family: var(--mono); }
.lc-fam-chip i.dim { color: var(--text-3); }
.lc-fam-hint { font-size: var(--fs-2xs); color: var(--text-3); margin-top: 10px; }

.lc-spell { text-align: center; }
/* 预览词交给 BlurText 逐字凝出,自身入场动画置空 */
.lc-preview-word {
  font-family: var(--serif);
  font-size: clamp(40px, 7vw, 56px);
  font-weight: 600; color: var(--text); letter-spacing: 0.04em;
  /* 词是这一幕的星名:与三幕大词同一语言,统一暖金光晕 */
  text-shadow: 0 0 36px color-mix(in srgb, var(--gold) 22%, transparent);
}
.lc-mask {
  font-family: var(--mono); font-size: clamp(26px, 5vw, 34px); letter-spacing: 0.35em;
  color: var(--text-2); margin-bottom: 16px; min-height: 40px; font-variant-numeric: tabular-nums;
  transition: color 0.4s var(--ease);
}
/* 拼对:掩码词升金(词之心塔尖灯的语言,晴空降暗琥珀) */
.lc-spell.passed .lc-mask { color: var(--gold); }
.lc-spell-row { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; }
.lc-input {
  font-family: var(--mono); font-size: var(--fs-lg); color: var(--text);
  background: var(--surface); border: 1.5px solid var(--line); border-radius: 10px;
  padding: 10px 16px; width: min(320px, 100%); outline: none; text-align: center;
  transition: border-color .18s var(--ease), color .3s var(--ease);
}
.lc-input:focus { border-color: var(--accent); }
.lc-input.ok { border-color: var(--success); color: var(--success); }
.lc-hint-btn {
  border: 1px solid var(--line); border-radius: 10px; background: var(--surface);
  color: var(--text-2); font-size: var(--fs-sm); padding: 10px 16px; cursor: pointer;
  transition: all .18s var(--ease);
}
.lc-hint-btn:hover { color: var(--accent); border-color: var(--line-accent); transform: translateY(-2px); }
.lc-spell-hint { font-size: var(--fs-xs); color: var(--text-3); margin-top: 12px; line-height: 1.7; }

/* 拼对星点亮仪式:金四芒星 pill(与回忆幕 .lr-lit 同一语言) */
.lc-lit {
  display: inline-flex; align-items: center; gap: 10px;
  margin: 0 auto 16px; padding: 8px 18px;
  border: 1px solid color-mix(in srgb, var(--gold) 35%, transparent);
  border-radius: 999px; color: var(--gold);
  animation: terrRise 0.45s var(--ease) backwards, starFlare 1.2s var(--ease) 0.2s 1;
}
[data-theme='light'] .lc-lit {
  animation: terrRise 0.45s var(--ease) backwards, starFlareLight 1.2s var(--ease) 0.2s 1;
}
.lc-lit-star {
  width: 12px; height: 12px; background: var(--gold);
  clip-path: polygon(50% 0, 58% 42%, 100% 50%, 58% 58%, 50% 100%, 42% 58%, 0 50%, 42% 42%);
  /* 原硬编码奶油色光晕换金令牌:与回忆幕 lr-lit-star 同一记法,四主题成立 */
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--gold) 50%, transparent));
}
[data-theme='light'] .lc-lit-star { filter: none; }
.lc-lit-text { font-size: var(--fs-xs); letter-spacing: 0.14em; }

.lc-foot { display: flex; justify-content: center; margin-top: 30px; }
.lc-next { font-size: var(--fs-md); padding: 10px 26px; }
</style>
