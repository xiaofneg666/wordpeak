<script setup>
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import HowToTrain from '../components/HowToTrain.vue'
import SettleCard from '../components/SettleCard.vue'
import { useUniverse } from '../stores/universe'
import { api } from '../api'
import { speak, listenOnce, recognizerSupported, scoreSpeech } from '../speech'
import { message } from '../ui'
import EmptyState from '../components/EmptyState.vue'

const store = useUniverse()
const speaking = computed(() => store.passages.filter((p) => p.type === 'speaking'))
const pid = ref(null)
const p = computed(() => speaking.value.find((x) => x.id === pid.value))
const supported = recognizerSupported()
// 词库 IPA 查表:音素级比对优先用词库音标,没收录的词走拼读兜底
const ipaMap = computed(() => new Map(store.words.map((w) => [w.word, w.ipa])))
const ipaOf = (w) => ipaMap.value.get(w)

const recIdx = ref(-1)
const scores = ref({})
const err = ref('')
const waves = ref([]) // 每句一行实时波形
let waveTimer = null
let alive = true
let recognizer = null // 进行中的 SpeechRecognition 实例(换篇时 abort,防止旧回调越界打分)
onMounted(() => {
  // 错题本深链:带着具体语料进入
  if (store.pendingPassage?.mod === 'speaking') { pid.value = store.pendingPassage.id; store.pendingPassage = null }
})
// KeepAlive 回场:可能带着错题深链的新篇(切走再回来直接落那篇)
onActivated(() => {
  if (store.pendingPassage?.mod === 'speaking') { pid.value = store.pendingPassage.id; store.pendingPassage = null }
})
// KeepAlive 切走:识别器/麦克风/伪波形全停——别在别的领地后台录音
onDeactivated(() => {
  try { recognizer?.abort() } catch { /* ignore */ }
  recognizer = null
  stopUserWave()
  clearInterval(waveTimer)
  waveTimer = 0
  alive = false
})
onActivated(() => { alive = true })
onUnmounted(() => { alive = false; clearInterval(waveTimer); stopUserWave(); try { recognizer?.abort() } catch { /* ignore */ } })

function pickPassage(x) {
  // 录音进行中换篇:先停识别和波形,旧回调里 si 可能已越出新篇句数
  try { recognizer?.abort() } catch { /* ignore */ }
  recognizer = null
  stopUserWave()
  clearInterval(waveTimer)
  recIdx.value = -1; waves.value = []
  pid.value = x.id; scores.value = {}; err.value = ''; resetAdvice()
}

// ---------- 录音真实波形采集(Web Audio AnalyserNode,与语音识别并行开麦) ----------
const WAVE_BARS = 120
const recWave = { ctx: null, analyser: null, stream: null, raf: 0, peaks: [] }
async function captureUserWave() {
  if (!navigator.mediaDevices?.getUserMedia) return
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (recIdx.value < 0) { stream.getTracks().forEach((t) => t.stop()); return } // 识别已结束,别留麦克风口
    recWave.stream = stream
    recWave.ctx = new (window.AudioContext || window.webkitAudioContext)()
    recWave.analyser = recWave.ctx.createAnalyser()
    recWave.analyser.fftSize = 2048
    recWave.ctx.createMediaStreamSource(stream).connect(recWave.analyser)
    recWave.peaks = []
    const data = new Uint8Array(recWave.analyser.fftSize)
    const sample = () => {
      if (!recWave.analyser) return
      recWave.analyser.getByteTimeDomainData(data)
      let peak = 0
      for (let i = 0; i < data.length; i += 4) {
        const v = Math.abs(data[i] - 128) / 128
        if (v > peak) peak = v
      }
      recWave.peaks.push(peak)
      recWave.raf = requestAnimationFrame(sample)
    }
    sample()
  } catch { /* 麦克风不可用:双轨对比时下轨留空,不影响打分 */ }
}
function stopUserWave() {
  cancelAnimationFrame(recWave.raf); recWave.raf = 0
  try { recWave.stream?.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
  try { recWave.ctx?.close() } catch { /* ignore */ }
  recWave.stream = null; recWave.analyser = null; recWave.ctx = null
}
// 采样振幅序列降采样成固定根数的能量条
function packUserWave() {
  const src = recWave.peaks
  if (!src.length) return null
  return Array.from({ length: WAVE_BARS }, (_, i) => {
    const a = Math.floor((i * src.length) / WAVE_BARS)
    const b = Math.max(a + 1, Math.floor(((i + 1) * src.length) / WAVE_BARS))
    let m = 0
    for (let j = a; j < b && j < src.length; j++) if (src[j] > m) m = src[j]
    return Math.min(1, Math.round(m * 160) / 100) // 归一化增益
  })
}

// ---------- 双轨对比波形 ----------
// 上轨 = 示范原音(合成语音无法回采,按句中词生成确定性能量包络)
function demoWave(text, n = WAVE_BARS) {
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return Array.from({ length: n }, () => 0.1)
  const unit = n / words.length
  return Array.from({ length: n }, (_, i) => {
    const w = Math.min(words.length - 1, Math.floor(i / unit))
    const seed = [...words[w]].reduce((a, c) => a + c.charCodeAt(0), 0)
    const pos = (i - w * unit) / unit
    const env = Math.sin(Math.PI * Math.min(1, Math.max(0.05, pos))) // 词首尾弱、词腹强
    return 0.1 + 0.85 * env * (0.55 + 0.45 * Math.abs(Math.sin(seed * 0.7 + i * 0.9)))
  })
}
// 逐位比对:阈值以上算"有声";一方有声一方没声 → 错位区(读漏/读多)
function compareWaves(si) {
  const s = scores.value[si]
  const sentence = p.value?.sentences?.[si]
  if (!s?.userWave || !sentence) return null
  const demo = demoWave(sentence.en)
  const TH = 0.2
  return demo.map((d, i) => {
    const u = s.userWave[i] ?? 0
    const dOn = d > TH, uOn = u > TH
    const flag = dOn === uOn ? '' : (dOn ? 'miss' : 'extra') // miss=示范有/你没读,extra=你多读
    return { d, u, flag }
  })
}

function startRecord(si) {
  err.value = ''
  recIdx.value = si
  delete advice.value[si] // 重新跟读会覆盖得分,旧建议一并清掉
  advice.value = { ...advice.value }
  // 启动伪波形(浏览器没给原始流)
  waves.value = Array.from({ length: 28 }, () => 0.15)
  waveTimer = setInterval(() => {
    if (!alive) return
    waves.value = Array.from({ length: 28 }, (_, i) => {
      const t = performance.now() / 1000 + i * 0.2
      return 0.25 + 0.7 * Math.abs(Math.sin(t * 5 + i * 0.6))
    })
  }, 70)
  recognizer = listenOnce({
    onResult: (transcript) => {
      if (!alive) return
      const sentence = p.value?.sentences?.[si]
      if (!sentence) return // 换篇/数据刷新后旧回调兜底:si 已越界,直接丢弃
      const s = scoreSpeech(sentence.en, transcript, { ipaOf })
      scores.value = { ...scores.value, [si]: { ...s, transcript } }
      store.api_submitSpeaking(p.value.id, si, s.score, transcript).then(() => store.refreshStats()).catch(() => {})
    },
    onEnd: () => {
      if (!alive) return
      stopUserWave()
      const wave = packUserWave() // 结算前把真实采样压成能量条,回放对比用
      recIdx.value = -1; clearInterval(waveTimer); waves.value = []
      if (wave && scores.value[si]) {
        scores.value = { ...scores.value, [si]: { ...scores.value[si], userWave: wave } }
      }
    },
    onError: (e) => {
      if (!alive) return
      stopUserWave()
      recIdx.value = -1; clearInterval(waveTimer); waves.value = []
      err.value = e === 'not-allowed' ? '麦克风权限被拒绝，请在浏览器里允许麦克风后重试' : `识别出错: ${e}`
      message.error(err.value)
    },
  })
  captureUserWave() // 与识别并行采集真实波形(失败静默降级)
}

function chipCls(sc) { return sc.score >= 0.8 ? 'green' : sc.score >= 0.5 ? 'amber' : 'red' }
// 得分一句话:按真实命中数说话,高分不空夸、低分给具体动作
function scoreNote(s) {
  const hit = s.words.filter((w) => w.matched).length
  const total = s.words.length
  if (s.score >= 0.9) return `${hit}/${total} 个词都读到了，节奏也稳，这句可以过`
  if (s.score >= 0.75) return `读准了 ${hit}/${total} 个词，剩下标红的那些再单独跟一遍`
  if (s.score >= 0.5) return `读准 ${hit}/${total} 个词，先点喇叭重听示范，对照红标的位置找差距`
  return `只读准 ${hit}/${total} 个词，不急，把示范多听几遍，一句拆成两段慢慢跟`
}
function ringColor(sc) {
  if (sc.score >= 0.8) return 'var(--success)'
  if (sc.score >= 0.5) return 'var(--warn)'
  return 'var(--danger)'
}

// ---------- AI 发音建议(后端 /api/ask:有 LLM key 走模型,无 key 自动降级本地规则分析) ----------
const advice = ref({})   // si -> { advice:{problem,advice,words}, source } | { loading } | { error }
async function askAdvice(si) {
  const sentence = p.value?.sentences?.[si]
  if (!sentence || !scores.value[si] || advice.value[si]?.loading) return
  advice.value = { ...advice.value, [si]: { loading: true } }
  try {
    const data = await api.ask(scores.value[si].transcript || '', sentence.en)
    advice.value = { ...advice.value, [si]: data }
  } catch (e) {
    advice.value = { ...advice.value, [si]: { error: '建议服务暂时不可用,稍后再试' } }
  }
}
function resetAdvice() { advice.value = {} }

// ---------- 整篇结算:句句读完 = 竞技场清场 ----------
// 每句已有环形分,但「整篇完成」的时刻原来是空的;均值环 + 上次对比补上这一环
const allDone = computed(() => !!p.value && p.value.sentences.every((_, si) => scores.value[si]))
const avgScore = computed(() => {
  const list = Object.values(scores.value)
  return list.length ? list.reduce((a, s) => a + s.score, 0) / list.length : 0
})
const bestWorst = computed(() => {
  const list = Object.values(scores.value).map((s) => Math.round(s.score * 100))
  return list.length ? { best: Math.max(...list), worst: Math.min(...list) } : null
})
// 终幕小星墙:一句一星,≥80 金 / ≥50 琥珀 / 其余红,收束级联逐个点亮
const starWall = computed(() =>
  p.value ? p.value.sentences.map((_, si) => scores.value[si]?.score ?? null) : [])
// 上次整篇均值:每篇一记,localStorage wv_speak_last(库里 speaking_results 是逐句行,拼均值要窗口聚合,本地记更轻)
const SPEAK_LAST_KEY = 'wv_speak_last'
function lastSpeakAvg(passageId) {
  try { return JSON.parse(localStorage.getItem(SPEAK_LAST_KEY) || '{}')[passageId] ?? null } catch { return null }
}
const speakPrev = ref(null)
watch(allDone, (done) => {
  if (!done || !p.value) return
  speakPrev.value = lastSpeakAvg(p.value.id)
  try {
    const all = JSON.parse(localStorage.getItem(SPEAK_LAST_KEY) || '{}')
    all[p.value.id] = Math.round(avgScore.value * 100) / 100
    localStorage.setItem(SPEAK_LAST_KEY, JSON.stringify(all))
  } catch { /* 隐私模式 */ }
})
function passageLine(avg) {
  if (avg >= 0.85) return '整篇都跟下来了，这个影子跟读的节奏可以带去别的篇'
  if (avg >= 0.7) return '大半都读到位了，把标红的句子再单句过一遍就齐了'
  if (avg >= 0.5) return '骨架有了，先攻最低分的那句——一次一句，别整篇重来'
  return '别急，回到第一句，听一遍跟一遍，八句拆成八次小胜利'
}
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner fade-in">
      <div class="terr-head">
        <div class="terr-kicker">TERRITORY · SPEAKING</div>
        <h2 class="terr-title"><BlurText text="口语竞技场" as="span" /></h2>
        <div class="terr-latin">SPEAKING ARENA</div>
        <div class="terr-rule" aria-hidden="true" />
        <p class="terr-sub">
          影子跟读：先听一遍示范，再跟着读，系统会逐词告诉你哪些读到了、哪些没读准。8 句练完一篇。
        </p>
      </div>

      <!-- 怎么练才有效:方法论条(收起一行,展开步骤) -->
      <HowToTrain view="speaking" />

      <!-- 语料加载中:skeleton 占位 -->
      <template v-if="store.fetching">
        <div class="passage-head">
          <span v-for="i in 3" :key="i" class="skeleton sk-pick" :style="{ width: `${100 + i * 20}px` }" />
        </div>
        <div class="sk-cards">
          <div v-for="i in 3" :key="i" class="skeleton sk-card" />
        </div>
      </template>

      <!-- 无语料:空态 -->
      <EmptyState
        v-else-if="!speaking.length"
        icon="场" title="这里还没有跟读语料"
        desc="语料刷新一下通常就能加载出来;一直空着,晚点再来"
      />

      <template v-else>
        <div class="scene-hint">PICK A SCENE · 挑一个情景，先听示范再开口跟读</div>
        <div class="passage-head">
          <button
            v-for="x in speaking" :key="x.id"
            class="passage-pick" :class="{ active: pid === x.id }"
            @click="pickPassage(x)"
          >{{ x.title }} <span class="pp-lv">Lv.{{ x.level }}</span></button>
        </div>

        <!-- 还没选语料:引导选择(点阵底纹,与回声谷的空信号区同一空气感) -->
        <div v-if="!p" class="pick-empty dots-host">
          <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.3" />
          <EmptyState
            icon="选" title="从上面挑一篇，开始影子跟读"
            desc="每句先听示范再开口，读完会逐词标出你没读准的地方，照着再练一遍"
          >
            <button class="btn primary" @click="pickPassage(speaking[0])">就从第一篇「{{ speaking[0].title }}」开始</button>
          </EmptyState>
        </div>

        <!-- 场景头:选中篇此前只活在 pill 里,给它一个领地命名式落点 + 跟读进度读数 -->
      <div v-if="p" class="scene-head dots-host">
        <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.24" />
        <div class="scene-meta">
          <div class="scene-kicker">SHADOW READING · 影子跟读</div>
          <div class="scene-title">{{ p.title }}</div>
          <div class="scene-sub">{{ p.sentences.length }} 句 · Lv.{{ p.level }} · 逐词比对</div>
        </div>
        <div class="scene-progress">
          <div class="sp-read">
            <span class="sp-count"><CountNum :v="Object.keys(scores).length" mono /><i>/{{ p.sentences.length }}</i></span>
            <span class="sp-label">句已跟读</span>
          </div>
          <div class="bar sp-bar" :class="{ green: allDone }">
            <i :style="{ width: `${Math.min(100, (Object.keys(scores).length / (p.sentences.length || 1)) * 100)}%` }" />
          </div>
        </div>
      </div>

      <p v-if="!supported && pid" class="warn-banner">
        当前浏览器不支持语音识别（推荐 Chrome 或 Edge）。你仍可以照着示范读，只是没法自动打分。
      </p>
      <p v-if="err" class="error-banner">{{ err }}</p>

      <div v-if="p" class="sentence-list">
        <div
          v-for="(s, si) in p.sentences" :key="si"
          class="sentence-card" :class="[{ recording: recIdx === si, scored: scores[si] }, scores[si] ? chipCls(scores[si]) : '']"
          :style="{ '--i': si }"
        >
          <!-- 录音中红色脉动环 -->
          <div v-if="recIdx === si" class="rec-pulse">
            <span /><span /><span />
          </div>

          <div class="sentence-head">
            <div class="sentence-actions">
              <button class="play-btn" @click="speak(s.en)" title="听示范"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>
              <button
                class="play-btn record-btn"
                :disabled="recIdx === si || !supported"
                :title="supported ? (recIdx === si ? '正在收音' : '跟读这一句') : '当前浏览器不支持语音识别'"
                @click="startRecord(si)"
              ><svg v-if="recIdx === si" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg></button>
            </div>
            <div class="sentence-num">{{ String(si + 1).padStart(2, '0') }}</div>
            <div class="sentence-main">
              <div class="sentence-en">
                <template v-if="scores[si]">
                  <span
                    v-for="(w, wi) in scores[si].words" :key="wi"
                    class="speak-word" :class="w.matched ? 'hit' : 'miss'"
                    :title="`音素相似度 ${Math.round((w.similarity ?? 0) * 100)}%${w.said && w.said !== w.word ? ' · 你说了 ' + w.said : ''}`"
                  >{{ w.word }}<button
                    v-if="!w.matched" class="word-replay" title="重听该词"
                    @click.stop="speak(w.word, { rate: 0.6 })"
                  ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg></button> </span>
                </template>
                <template v-else>{{ s.en }}</template>
              </div>
              <div class="sentence-zh">{{ s.zh }}</div>
              <!-- 录音中波形 -->
              <div v-if="recIdx === si" class="wave-bar">
                <div v-for="(v, k) in waves" :key="k" :style="{ height: `${v * 100}%` }" />
              </div>
              <!-- 识别原文:极淡底 + mono 序号读数,不再裸排 -->
              <div v-if="scores[si]" class="transcript-row">
                <span class="tr-idx">{{ String(si + 1).padStart(2, '0') }}</span>
                <span class="text-3">你说了:</span>
                <span class="transcript">{{ scores[si].transcript || '(没听清)' }}</span>
              </div>
              <!-- 得分一句话 -->
              <div v-if="scores[si]" class="score-note" :class="chipCls(scores[si])">{{ scoreNote(scores[si]) }}</div>
              <!-- AI 发音建议:后端有 LLM key 走模型,无 key 自动降级本地规则分析 -->
              <button
                v-if="scores[si]?.transcript && !advice[si]"
                class="ai-ask-btn"
                @click="askAdvice(si)"
              >AI 发音建议</button>
              <div v-if="advice[si]?.loading" class="ai-card">
                <span class="ai-dot" /><span class="ai-dot" /><span class="ai-dot" />
                正在分析你刚才的发音…
              </div>
              <div v-else-if="advice[si]?.error" class="ai-card ai-error">{{ advice[si].error }}</div>
              <div v-else-if="advice[si]?.advice" class="ai-card ai-loaded fade-in">
                <div class="ai-head">
                  <span class="ai-src" :class="advice[si].source">{{ advice[si].source === 'llm' ? 'AI 教练' : '本地分析' }}</span>
                  <span class="ai-problem">{{ advice[si].advice.problem }}</span>
                </div>
                <div v-if="advice[si].advice.words?.length" class="ai-words">
                  <button
                    v-for="w in advice[si].advice.words" :key="w"
                    class="ai-word" title="点我重听该词"
                    @click="speak(w, { rate: 0.6 })"
                  >{{ w }}</button>
                </div>
                <p class="ai-text">{{ advice[si].advice.advice }}</p>
              </div>
              <!-- 双轨对比波形:上=示范(伪包络) 下=你的录音(真实采样);红=没读出来 橙=多读了 -->
              <div v-if="scores[si]?.userWave" class="dual-wave fade-in">
                <div class="dw-row">
                  <span class="dw-tag demo">示范</span>
                  <div class="dw-track">
                    <div v-for="(b, k) in compareWaves(si)" :key="k" class="dw-cell" :class="b.flag">
                      <i class="dw-bar" :style="{ height: `${Math.max(4, b.d * 100)}%` }" />
                    </div>
                  </div>
                </div>
                <div class="dw-row">
                  <span class="dw-tag user">你</span>
                  <div class="dw-track">
                    <div v-for="(b, k) in compareWaves(si)" :key="k" class="dw-cell" :class="b.flag">
                      <i class="dw-bar user" :style="{ height: `${Math.max(4, b.u * 100)}%` }" />
                    </div>
                  </div>
                </div>
                <div class="dw-legend">
                  <span>上面是你听到的示范，下面是你刚才读的</span>
                  <span class="miss">红色：示范里有、你没读出来</span>
                  <span class="extra">橙色：你多读了</span>
                </div>
              </div>
            </div>

            <!-- 得分环:出分那一刻数字从 0 滚上去(CountNum),环本身弹入 -->
            <div v-if="scores[si]" class="score-ring" :style="{ background: `conic-gradient(${ringColor(scores[si])} ${scores[si].score * 360}deg, var(--surface-active) 0deg)` }">
              <div class="score-ring-inner">
                <b><CountNum :v="Math.round(scores[si].score * 100)" mono /></b>
                <span>分</span>
              </div>
            </div>
            <span v-else-if="recIdx === si" class="rec-tag">收音中</span>
          </div>
        </div>
      </div>

      <!-- 整篇结算:句句读完才升起的清场卡——均值环 + 最高/最低 + 上次整篇对比 -->
      <SettleCard
        v-if="allDone"
        :score="avgScore"
        :prev="speakPrev" kicker="ARENA CLEARED · 竞技场清场"
        :title="passageLine(avgScore)"
      >
        <div v-if="bestWorst" class="arena-stats">
          <span class="chip dim">{{ Object.keys(scores).length }} 句全部完成</span>
          <span class="chip green">最高单句 {{ bestWorst.best }} 分</span>
          <span class="chip amber">最低单句 {{ bestWorst.worst }} 分</span>
        </div>
        <!-- 每句小星逐个点亮:清场的星墙,一句一颗;mono 小标注把这排星说成「军功墙」 -->
        <div class="arena-stars cascade" aria-hidden="true">
          <span
            v-for="(sc, si) in starWall" :key="si"
            class="arena-star" :class="sc == null ? 'none' : sc >= 0.8 ? 'gold' : sc >= 0.5 ? 'amber' : 'red'"
            :title="`第 ${si + 1} 句 ${sc == null ? '—' : Math.round(sc * 100)} 分`"
          />
        </div>
        <div class="arena-stars-cap">STAR WALL · 句句清点</div>
      </SettleCard>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* passage-pick/.error-banner/.warn-banner:全局 utilities */

/* BlurText 接管「口语竞技场」入场:全局 terrRise 在本视图置空,避免双重动画 */
.terr-title { animation: none; }

/* 语料加载骨架 */
.sk-pick { height: 30px; border-radius: 8px; }
.sk-cards { display: flex; flex-direction: column; gap: 12px; }
.sk-card { height: 90px; border-radius: 14px; }

/* 情景挑选 hint(与回声谷 signal-hint 同语言) */
.scene-hint {
  font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.18em;
  color: var(--text-3); margin-bottom: 8px;
}
/* 还没选篇的空态:点阵空气感 */
.pick-empty { position: relative; }

/* 场景头:选中篇的落点(命名式 kicker → 标题 → mono 副题)+ 跟读进度读数 */
.scene-head {
  position: relative; overflow: hidden;
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 24px; flex-wrap: wrap;
  padding: 22px 24px 20px; margin-bottom: 16px;
  border: 1px solid color-mix(in srgb, var(--accent) 14%, var(--line));
  border-radius: var(--r-xl);
  background:
    radial-gradient(480px 260px at 92% -40%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 65%),
    var(--surface);
  animation: riseIn 0.5s var(--ease) both;
}
.scene-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.22em; color: var(--accent); margin-bottom: 8px;
}
/* kicker 下 4px 金刻线:竞技场=金——与终幕星墙、sp-bar 金点构成同一语义链 */
.scene-kicker::after {
  content: ''; display: block; width: 34px; height: 4px;
  border-radius: 2px; margin-top: 8px;
  background: linear-gradient(90deg, var(--gold), color-mix(in srgb, var(--gold) 25%, transparent));
  box-shadow: 0 0 10px color-mix(in srgb, var(--gold) 22%, transparent);
}
[data-theme='light'] .scene-kicker::after { box-shadow: none; }
.scene-title { font-size: var(--fs-xl); font-weight: 600; letter-spacing: -0.01em; line-height: 1.2; }
.scene-sub {
  font-family: var(--mono); font-size: var(--fs-xs); color: var(--text-3);
  margin-top: 4px; letter-spacing: 0.03em;
}
.scene-progress { position: relative; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.sp-read { display: inline-flex; align-items: baseline; gap: 8px; }
.sp-count {
  font-family: var(--mono); font-size: var(--fs-2xl); font-weight: 700; color: var(--text);
  font-variant-numeric: tabular-nums; line-height: 1;
}
.sp-count i { font-style: normal; font-size: var(--fs-base); color: var(--text-4); }
.sp-label { font-size: var(--fs-2xs); color: var(--text-3); letter-spacing: 0.06em; }
.sp-bar { width: 160px; }
/* 进度前沿一点金光:跟读是走向「清场点金」的路,行进端先亮成金色 */
.sp-bar i { position: relative; }
.sp-bar i::after {
  content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 2px;
  border-radius: 2px; background: var(--gold);
  box-shadow: 0 0 8px color-mix(in srgb, var(--gold) 55%, transparent);
}
[data-theme='light'] .sp-bar i::after { box-shadow: none; }

.sentence-list { display: flex; flex-direction: column; gap: 12px; }
/* 逐句入场:借用信号轨道的 sigRise 级联(backwards 只占延迟期,不锁终态) */
.sentence-list > * { animation: sigRise 0.5s var(--ease) backwards; animation-delay: calc(var(--i, 0) * 45ms); }
.sentence-card {
  position: relative; padding: 18px 20px; border-radius: 14px;
  background: var(--surface); border: 1px solid var(--line);
  transition: all 0.25s var(--ease); overflow: hidden;
}
/* 已评分:左缘刻线按分数档上色(green/amber/red 类由模板喂),扫一眼就知道哪句要重练 */
.sentence-card::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
  background: var(--success); transform: scaleY(0); transform-origin: top;
  transition: transform 0.35s var(--ease), background 0.35s var(--ease);
}
.sentence-card.scored { border-color: var(--line-strong); }
.sentence-card.scored::before { transform: scaleY(1); }
.sentence-card.green::before { background: var(--success); }
.sentence-card.amber::before { background: var(--warn); }
.sentence-card.red::before { background: var(--danger); }
/* 普通态 hover:亮边 + 轻升(已评分卡有自己的档位色,录音卡有红脉动,都不叠) */
.sentence-card:not(.scored):not(.recording):hover {
  border-color: var(--line-accent);
  transform: translateY(-2px);
}
/* 已评分:按得分档位上 4% 同色底——8 句扫一眼分档,不用逐个读环 */
.sentence-card.scored.green { background: color-mix(in srgb, var(--success) 4%, var(--surface)); }
.sentence-card.scored.amber { background: color-mix(in srgb, var(--warn) 4%, var(--surface)); }
.sentence-card.scored.red { background: color-mix(in srgb, var(--danger) 4%, var(--surface)); }
.sentence-card.recording {
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 5%, transparent);
  animation: cardPulseRed 2s ease-in-out infinite;
}
@keyframes cardPulseRed {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger) 0%, transparent); }
  50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--danger) 15%, transparent); }
}

/* 录音中红色脉动环(3 圈扩散) */
.rec-pulse { position: absolute; top: 18px; right: 18px; pointer-events: none; }
.rec-pulse span {
  position: absolute; top: 0; right: 0; width: 14px; height: 14px;
  border-radius: 50%; background: var(--danger);
  animation: ringPulse 1.8s ease-out infinite;
}
.rec-pulse span:nth-child(2) { animation-delay: 0.6s; }
.rec-pulse span:nth-child(3) { animation-delay: 1.2s; }
@keyframes ringPulse {
  0% { transform: scale(0.6); opacity: 1; }
  100% { transform: scale(3); opacity: 0; }
}

.sentence-head { display: flex; align-items: center; gap: 14px; }
.sentence-actions { display: flex; gap: 6px; }
.play-btn {
  width: 36px; height: 36px; border-radius: 10px;
  background: var(--surface); border: 1px solid var(--line);
  color: var(--text); cursor: pointer; font-size: var(--fs-base);
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.play-btn:hover { background: var(--accent-soft); border-color: var(--line-accent); color: var(--accent); transform: translateY(-2px); }
.play-btn svg { width: 15px; height: 15px; }
/* 录音键:闲时只描红边(整列常红太吵),正在收音才整颗亮红 */
.play-btn.record-btn {
  background: var(--surface); color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 40%, transparent);
}
.play-btn.record-btn:hover {
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border-color: var(--danger); color: var(--danger); transform: translateY(-2px);
}
.play-btn.record-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.sentence-card.recording .record-btn {
  background: var(--danger); border-color: var(--danger); color: var(--on-danger);
  opacity: 1; cursor: default;
  animation: recBtnPulse 1.8s ease-in-out infinite;
}
@keyframes recBtnPulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger) 35%, transparent); }
  50% { box-shadow: 0 0 10px 2px color-mix(in srgb, var(--danger) 30%, transparent); }
}
.sentence-num { font-family: var(--mono); font-size: var(--fs-sm); font-weight: 700; color: var(--accent); min-width: 24px; font-variant-numeric: tabular-nums; }
.sentence-main { flex: 1; min-width: 0; }
.sentence-en { font-size: var(--fs-md); line-height: 1.8; }
.sentence-zh { font-size: var(--fs-sm); color: var(--text-3); margin-top: 4px; }

/* 逐词比对:去掉划痕保住可读性,色块 + 底部色条双层标记(hit/miss 对称) */
.speak-word {
  padding: 2px 6px; margin: 0 1px; border-radius: 6px;
  border-bottom: 2px solid transparent;
  transition: background 0.2s var(--ease), border-color 0.2s var(--ease);
}
.speak-word.hit {
  background: color-mix(in srgb, var(--success) 16%, transparent);
  color: var(--success);
  border-bottom-color: color-mix(in srgb, var(--success) 55%, transparent);
}
.speak-word.miss {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
  border-bottom-color: var(--danger);
}
/* 错词重听按钮(音素级比对后单独高亮 + 重听) */
.word-replay {
  margin-left: 4px; padding: 1px 4px; border-radius: 5px; cursor: pointer;
  background: var(--surface); border: 1px solid var(--line-strong);
  color: var(--text-3); font-size: var(--fs-2xs); line-height: 1.4; vertical-align: middle;
  display: inline-flex; align-items: center;
  transition: all 0.15s var(--ease);
}
.word-replay svg { width: 10px; height: 10px; display: block; }
.word-replay:hover { background: var(--accent-soft); border-color: var(--line-accent); color: var(--accent); transform: translateY(-1px); }

.wave-bar { display: flex; align-items: center; gap: 2px; margin-top: 10px; height: 32px; }
.wave-bar > div { flex: 1; min-width: 2px; max-width: 4px; background: var(--danger); border-radius: 2px; box-shadow: 0 0 4px color-mix(in srgb, var(--danger) 60%, transparent); transition: height 0.1s; }

.transcript-row {
  margin-top: 8px; padding: 6px 10px; border-radius: 8px;
  font-size: var(--fs-sm); display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  background: color-mix(in srgb, var(--accent) 3%, transparent);
  transition: background 0.2s var(--ease);
}
.transcript-row:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); }
/* mono 序号:识别原文行的仪表读数,与本页 num/sp-count 同语言 */
.tr-idx {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 700;
  color: var(--text-3); letter-spacing: 0.05em; font-variant-numeric: tabular-nums;
}
.transcript {
  font-family: var(--mono); padding: 2px 8px; border-radius: 5px;
  background: var(--accent-soft); color: var(--accent);
}
/* 得分一句话(颜色随档位) */
.arena-stats { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
/* 终幕星墙:四芒星 clip(与暗物质区 dm-star 同语言),金=词之心点亮色;
   星放大到 16px 居中排开成「军功墙」,是整页的视觉收束点 */
.arena-stars { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; justify-content: center; }
.arena-star {
  width: 16px; height: 16px;
  clip-path: polygon(50% 0, 58% 42%, 100% 50%, 58% 58%, 50% 100%, 42% 58%, 0 50%, 42% 42%);
  background: currentColor;
}
/* 军功墙的 mono 小标注:与 arena-stats 的 chip 同一收束语气 */
.arena-stars-cap {
  margin-top: 8px; text-align: center;
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.2em; color: var(--text-4);
}
.arena-star.gold { color: var(--gold); filter: drop-shadow(0 0 5px color-mix(in srgb, var(--gold) 45%, transparent)); }
[data-theme='light'] .arena-star.gold { filter: none; }
.arena-star.amber { color: var(--warn); }
.arena-star.red { color: var(--danger); }
.arena-star.none { color: var(--text-4); opacity: 0.4; }
.score-note { margin-top: 6px; font-size: var(--fs-sm); }
.score-note.green { color: var(--success); }
.score-note.amber { color: var(--warn); }
.score-note.red { color: var(--danger); }

/* AI 发音建议(建议按钮 + 建议卡片) */
.ai-ask-btn {
  margin-top: 8px; padding: 6px 14px; border-radius: 999px; cursor: pointer;
  background: var(--accent-soft); border: 1px solid var(--line-accent);
  color: var(--accent); font-size: var(--fs-xs); font-weight: 600; font-family: inherit;
  transition: all 0.2s var(--ease);
}
.ai-ask-btn:hover { border-color: var(--accent); box-shadow: 0 0 14px color-mix(in srgb, var(--accent) 25%, transparent); }
.ai-card {
  margin-top: 8px; padding: 10px 14px; border-radius: 10px; font-size: var(--fs-sm);
  background: var(--surface-sunken); border: 1px solid var(--line-accent);
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  transition: border-color 0.25s var(--ease);
}
/* 建议卡 hover 亮边:与全站卡片同手感 */
.ai-card.ai-loaded:hover { border-color: var(--accent); }
.ai-card.ai-loaded { flex-direction: column; align-items: stretch; gap: 8px; }
.ai-dot {
  width: 5px; height: 5px; border-radius: 50%; background: var(--accent);
  animation: aiBlink 1s ease-in-out infinite;
}
.ai-dot:nth-child(2) { animation-delay: 0.2s; }
.ai-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes aiBlink { 50% { opacity: 0.2; } }
.ai-error { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 30%, transparent); }
.ai-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
/* 头行做成 kicker:mono pill 出处 + 衬线问题词,「发现了什么」先被念出来 */
.ai-src {
  flex-shrink: 0; padding: 2px 9px; border-radius: 999px;
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  background: var(--accent-soft); color: var(--accent);
  border: 1px solid var(--line-accent);
}
.ai-src.llm { background: color-mix(in srgb, var(--accent-2) 12%, transparent); color: var(--accent-2); border-color: color-mix(in srgb, var(--accent-2) 35%, transparent); }
.ai-problem { font-family: var(--serif); font-size: var(--fs-base); font-weight: 600; color: var(--text); }
.ai-words { display: flex; gap: 6px; flex-wrap: wrap; }
.ai-word {
  padding: 2px 10px; border-radius: 999px; cursor: pointer; font-family: var(--mono);
  font-size: var(--fs-xs); font-weight: 600;
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  color: var(--danger); transition: all 0.15s var(--ease);
}
.ai-word:hover { background: color-mix(in srgb, var(--danger) 18%, transparent); transform: translateY(-1px); }
.ai-text {
  color: var(--text-2); line-height: 1.7; margin: 0;
  border-top: 1px solid var(--line); padding-top: 10px;
}

/* 双轨对比波形 */
.dual-wave {
  margin-top: 10px; padding: 10px 12px;
  border-radius: 10px; background: var(--surface-sunken); border: 1px solid var(--line);
}
.dw-row { display: flex; align-items: center; gap: 8px; }
.dw-row + .dw-row { margin-top: 6px; }
.dw-tag {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 700;
  letter-spacing: 0.08em; color: var(--text-3); min-width: 36px; flex-shrink: 0;
}
.dw-tag.demo { color: var(--accent); }
.dw-tag.user { color: var(--success); }
.dw-track { display: flex; gap: 2px; height: 40px; flex: 1; align-items: center; }
.dw-cell { flex: 1; height: 100%; display: flex; align-items: center; border-radius: 2px; min-width: 1px; }
.dw-cell.miss { background: color-mix(in srgb, var(--danger) 16%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 30%, transparent); }
.dw-cell.extra { background: color-mix(in srgb, var(--warn) 14%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn) 28%, transparent); }
/* 双轨各配同色纵向渐变:示范=accent / 你=success,顶亮底隐,像能量的衰减 */
.dw-bar {
  display: block; width: 100%; border-radius: 2px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 85%, transparent), color-mix(in srgb, var(--accent) 35%, transparent));
}
.dw-bar.user {
  background: linear-gradient(180deg, color-mix(in srgb, var(--success) 85%, transparent), color-mix(in srgb, var(--success) 35%, transparent));
}
.dw-cell.miss .dw-bar { opacity: 0.45; }
.dw-legend { display: flex; gap: 10px; margin-top: 8px; font-size: var(--fs-xs); color: var(--text-3); flex-wrap: wrap; }
.dw-legend .miss { color: var(--danger); }
.dw-legend .extra { color: var(--warn); }

/* 得分环:conic 环弹入(squish 曲线),数字交给 CountNum 从 0 滚上去 */
.score-ring {
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: background 0.6s var(--ease);
  animation: ringPop 0.55s var(--ease-squish-2) backwards;
}
@keyframes ringPop { from { transform: scale(0.6); opacity: 0; } }
.score-ring-inner {
  width: 50px; height: 50px; border-radius: 50%;
  background: var(--surface); display: flex; flex-direction: column;
  align-items: center; justify-content: center; line-height: 1;
}
.score-ring-inner b { font-size: var(--fs-lg); font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text); }
.score-ring-inner span { font-size: var(--fs-2xs); color: var(--text-3); margin-top: 1px; }

/* 收音中标签:实底 danger 上的字走 --on-danger(暖夜自动换深字) */
.rec-tag {
  padding: 4px 10px; border-radius: 999px; flex-shrink: 0;
  background: var(--danger); color: var(--on-danger);
  font-size: var(--fs-xs); font-weight: 600;
  animation: pulseTag 1.4s ease-in-out infinite alternate;
}
@keyframes pulseTag {
  to { transform: scale(1.05); box-shadow: 0 0 12px color-mix(in srgb, var(--danger) 40%, transparent); }
}

@media (max-width: 768px) {
  .scene-head { padding: 18px; gap: 16px; }
  .scene-progress { align-items: flex-start; }
  .sp-bar { width: 120px; }
  /* 双轨 120 根能量条:窄屏退回 1px 缝,避免 2px 缝把轨道挤出屏幕 */
  .dw-track { gap: 1px; }
  .sentence-card { padding: 14px 16px; }
  .score-ring { width: 52px; height: 52px; }
  .score-ring-inner { width: 41px; height: 41px; }
  .score-ring-inner b { font-size: var(--fs-md); }
  .score-ring-inner span { font-size: var(--fs-2xs); }
}
</style>
