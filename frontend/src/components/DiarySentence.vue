<script setup>
// 日记单句卡:中文对照 + 英文主文案,播放/跟读打分/手动改译文
// 跟读打分复用 speech.js 的 scoreSpeech(音素级,同口语竞技场);ipaOf 由父级传入(词库音标查表)
import { ref, onUnmounted } from 'vue'
import { speak, listenOnce, scoreSpeech } from '../speech'
import AppGlyph from './AppGlyph.vue'

const props = defineProps({
  zh: { type: String, default: '' },
  en: { type: String, required: true },
  rate: { type: Number, default: 1 },
  ipaOf: { type: Function, default: () => undefined },
  playing: { type: Boolean, default: false }, // 整篇连读时高亮当前句
})

const emit = defineEmits(['play', 'save-en'])

const following = ref(false)
const score = ref(null)
const followErr = ref('')
const editing = ref(false)
const draft = ref('')
let rec = null

// 跟读:一次识别 + 打分,得分与逐词命中展示在句卡内
function follow() {
  if (following.value) return
  following.value = true
  score.value = null
  followErr.value = ''
  rec = listenOnce({
    onResult: (transcript) => {
      score.value = { ...scoreSpeech(props.en, transcript, { ipaOf: props.ipaOf }), transcript }
    },
    onEnd: () => { following.value = false },
    onError: (e) => {
      following.value = false
      followErr.value = e === 'not-allowed' ? '麦克风权限被拒绝，请在浏览器里允许后重试' : `识别出错: ${e}`
    },
  })
}

function startEdit() {
  editing.value = true
  draft.value = props.en
}
function saveEdit() {
  editing.value = false
  const v = draft.value.trim()
  if (v && v !== props.en) emit('save-en', v)
}

// 没读准的词点一下单独重听
function playWord(w) { speak(w, { rate: Math.max(0.6, props.rate) }) }

onUnmounted(() => { try { rec?.abort() } catch { /* ignore */ } })
</script>

<template>
  <div class="dy-sent" :class="{ playing }">
    <div class="dy-sent-zh">{{ zh }}</div>
    <div v-if="!editing" class="dy-sent-en">
      {{ en }}
      <button class="dy-edit-btn" title="修正这句英文" aria-label="修正这句英文" @click="startEdit"><AppGlyph name="pen" :size="13" /></button>
    </div>
    <div v-else class="dy-edit-row">
      <input
        v-model="draft" class="dy-edit-input" placeholder="修正英文译文…"
        @keyup.enter="saveEdit" @keyup.esc="editing = false"
      >
      <button class="btn small primary" @click="saveEdit">改好</button>
      <button class="btn small ghost" @click="editing = false">取消</button>
    </div>

    <div class="dy-sent-actions">
      <button class="btn small" @click="emit('play')"><AppGlyph name="play" :size="12" /> 播放</button>
      <button class="btn small" :disabled="following" @click="follow">
        {{ following ? '● 录音中…请跟读' : '跟读' }}
      </button>
      <span v-if="followErr" class="dy-follow-err">{{ followErr }}</span>
      <template v-if="score">
        <span class="dy-score" :class="score.score >= 0.8 ? 'ok' : score.score >= 0.5 ? 'mid' : 'no'">
          {{ Math.round(score.score * 100) }} 分
        </span>
        <span class="dy-words">
          <span
            v-for="(w, i) in score.words" :key="i"
            class="dy-word" :class="w.matched ? 'ok' : 'no'"
            :title="w.said ? `你读成了: ${w.said}` : '点击重听这个词'"
            @click="playWord(w.word)"
          >{{ w.word }}</span>
        </span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dy-sent {
  position: relative;
  padding: 16px 18px 14px;
  border-radius: 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  transition: border-color 0.25s var(--ease), box-shadow 0.25s var(--ease);
}
/* 整篇连读时当前句高亮 */
.dy-sent.playing {
  border-color: var(--line-accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
/* 左缘 accent 刻线:连读进行中的句子立起一道「正在读」的光轨(与历史条目 open 刻线同一语言) */
.dy-sent.playing::before {
  content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 2px;
  border-radius: 2px; background: var(--accent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 45%, transparent);
  transform-origin: top; animation: unsealBar 0.4s var(--ease-out-3);
}
.dy-sent-zh { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.6; margin-bottom: 4px; }
.dy-sent-en { color: var(--text); font-size: var(--fs-md); font-weight: 500; line-height: 1.5; }
.dy-edit-btn {
  border: 0; background: transparent; color: var(--text-4); cursor: pointer;
  font-size: var(--fs-xs); margin-left: 6px; padding: 2px 5px; border-radius: 6px;
  transition: all 0.15s var(--ease); vertical-align: 1px;
}
.dy-edit-btn:hover { color: var(--accent); background: var(--accent-soft); }
.dy-edit-row { display: flex; gap: 8px; align-items: center; }
.dy-edit-input {
  flex: 1; min-width: 0; padding: 8px 12px; border-radius: 10px;
  background: var(--surface-sunken); border: 1px solid var(--line-strong);
  color: var(--text); font-size: var(--fs-base); font-family: inherit; outline: none;
}
.dy-sent-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.dy-follow-err { color: var(--danger); font-size: var(--fs-xs); }
.dy-score { font-family: var(--mono); font-weight: 700; font-size: var(--fs-md); }
/* 跟读高分(≥0.8 即 ok 档):分数染金 + 一枚小金星 —— 「读到位」是点亮时刻(绿字让给逐词命中) */
.dy-score.ok {
  color: var(--gold);
  text-shadow: 0 0 16px color-mix(in srgb, var(--gold) 25%, transparent);
}
.dy-score.ok::before {
  content: '✦'; font-size: var(--fs-2xs); vertical-align: 2px; margin-right: 5px;
  color: var(--gold); opacity: 0.9;
}
.dy-score.mid { color: var(--warn); }
.dy-score.no { color: var(--danger); }
.dy-words { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.dy-word {
  font-size: var(--fs-xs); padding: 2px 7px; border-radius: 6px; cursor: pointer;
  transition: all 0.15s var(--ease);
}
.dy-word.ok { color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent); }
.dy-word.no { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); text-decoration: line-through dotted; }
.dy-word:hover { filter: brightness(1.05); }
</style>
