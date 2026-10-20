<script setup>
// 拖拽装配车间:左侧零件库(打乱碎片) → 右侧装配台槽位
// 鼠标用 HTML5 drag & drop,触摸/点击用"点零件再点槽位"双模式
import { ref, computed, watch } from 'vue'

const props = defineProps({
  point: { type: Object, required: true },
})

// --- 确定性洗牌:同一语法点每次进入顺序一致 ---
function seededShuffle(arr, seed) {
  let s = 7
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) % 2147483647
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 48271) % 2147483647
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// --- 例句切分:在逗号/介词/连词处优先断开,切成 3-6 个碎片 ---
const BREAK_BEFORE = new Set([
  'in', 'on', 'at', 'from', 'to', 'with', 'for', 'of', 'about', 'before', 'after',
  'under', 'near', 'around', 'because', 'although', 'so', 'and', 'but', 'when', 'while', 'that',
])
function fragment(en) {
  const words = en.trim().split(/\s+/)
  const chunks = []
  let cur = []
  for (const w of words) {
    const clean = w.toLowerCase().replace(/[^a-z]/g, '')
    if ((cur.length >= 2 && BREAK_BEFORE.has(clean)) || cur.length >= 3) {
      chunks.push(cur.join(' '))
      cur = []
    }
    cur.push(w)
    if (/[,!?;:]$/.test(w)) { chunks.push(cur.join(' ')); cur = [] }
  }
  if (cur.length) chunks.push(cur.join(' '))
  while (chunks.length > 6) { // 太多则合并尾部
    const last = chunks.pop()
    chunks[chunks.length - 1] += ` ${last}`
  }
  while (chunks.length < 3) { // 太少则拆最长的一块
    const idx = chunks.findIndex((c) => c.split(' ').length > 1)
    if (idx === -1) break
    const parts = chunks[idx].split(' ')
    const mid = Math.ceil(parts.length / 2)
    chunks.splice(idx, 1, parts.slice(0, mid).join(' '), parts.slice(mid).join(' '))
  }
  return chunks
}

// --- 每语法点生成 2-3 道装配题:机械图纸 1 道 + 例句还原 1-2 道 ---
function buildPuzzles(point) {
  const out = []
  const parts = point.machine?.parts || []
  if (parts.length >= 3 && parts.length <= 6) {
    const pieces = parts.map((p, i) => ({ id: `m${i}`, text: p.value }))
    out.push({
      kind: 'machine',
      hint: '把零件装回原来的位置,想想哪个零件是"谁"、哪个是"做什么"',
      pieces: seededShuffle(pieces, point.title + 'm'),
      slots: parts.map((p, i) => ({ expect: `m${i}`, label: p.label })),
    })
  }
  ;(point.examples || []).slice(0, 2).forEach((e, i) => {
    const frags = fragment(e.en)
    if (frags.length < 3 || frags.length > 6) return
    const key = `e${i}`
    out.push({
      kind: 'sentence',
      hint: `还原这句英文:「${e.zh}」`,
      pieces: seededShuffle(frags.map((t, j) => ({ id: `${key}${j}`, text: t })), point.title + key),
      slots: frags.map((t, j) => ({ expect: `${key}${j}`, label: String(j + 1) })),
    })
  })
  return out
}

const puzzles = computed(() => buildPuzzles(props.point))
const puzzleIdx = ref(0)
const puzzle = computed(() => puzzles.value[puzzleIdx.value] || null)

const placed = ref([])        // 槽位 -> 已放零件 id(null 为空)
const selectedId = ref(null)  // 点选模式:当前选中的零件
const attempted = ref(false)
const success = ref(false)
const score = ref(0)
const solved = ref(0)
const msg = ref('')

function resetBoard() {
  placed.value = puzzle.value ? puzzle.value.slots.map(() => null) : []
  selectedId.value = null
  attempted.value = false
  success.value = false
  msg.value = ''
}
watch([puzzleIdx, () => props.point.title], resetBoard, { immediate: true })

const library = computed(() =>
  (puzzle.value?.pieces || []).filter((p) => !placed.value.includes(p.id)))

function pieceById(id) {
  return (puzzle.value?.pieces || []).find((p) => p.id === id)
}

// 放置:pieceId 为空则用点选的零件;支持槽-槽互换
function place(slotIdx, pieceId) {
  const pid = pieceId || selectedId.value
  if (!pid || !puzzle.value) return
  const arr = placed.value.slice()
  const from = arr.indexOf(pid)
  if (from === slotIdx) { selectedId.value = null; return }
  if (from !== -1) arr[from] = null
  if (arr[slotIdx] && from !== -1) arr[from] = arr[slotIdx] // 槽-槽互换
  arr[slotIdx] = pid
  placed.value = arr
  selectedId.value = null
  attempted.value = false // 移动后清除上次判定
  success.value = false
  msg.value = ''
}

function removeAt(slotIdx) {
  const arr = placed.value.slice()
  arr[slotIdx] = null
  placed.value = arr
  attempted.value = false
  success.value = false
  msg.value = ''
}

// HTML5 拖拽
function onDragStart(e, id) {
  selectedId.value = id // 拖拽失败时退化为点选,体验连续
  e.dataTransfer?.setData('text/plain', id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDropSlot(e, slotIdx) {
  const id = e.dataTransfer?.getData('text/plain') || selectedId.value
  place(slotIdx, id)
}
function onDropLibrary(e) {
  const id = e.dataTransfer?.getData('text/plain') || selectedId.value
  const arr = placed.value.slice()
  const i = arr.indexOf(id)
  if (i !== -1) { arr[i] = null; placed.value = arr; attempted.value = false; success.value = false }
  selectedId.value = null
}

// 点选(触摸友好):点零件 → 点槽位
function tapPiece(id) {
  selectedId.value = selectedId.value === id ? null : id
}
function tapSlot(slotIdx) {
  if (selectedId.value) place(slotIdx)
  else if (placed.value[slotIdx]) removeAt(slotIdx)
}

function judge() {
  if (!puzzle.value) return
  if (placed.value.some((p) => !p)) {
    msg.value = '还有空槽没装上,把所有零件都装上去再启动。'
    attempted.value = false
    return
  }
  attempted.value = true
  const wrong = puzzle.value.slots.filter((s, i) => placed.value[i] !== s.expect).length
  const ok = wrong === 0
  success.value = ok
  if (ok) {
    score.value += 10
    solved.value += 1
    msg.value = '装对了,机器转起来了。+10 分'
  } else {
    msg.value = `有 ${wrong} 个零件装错了位置,红色标出来了,换一换再启动一次。`
  }
}

function nextPuzzle() {
  if (!puzzles.value.length) return
  puzzleIdx.value = (puzzleIdx.value + 1) % puzzles.value.length
}
</script>

<template>
  <div v-if="puzzle" class="assembly" :class="{ success }">
    <div class="as-toolbar">
      <span class="as-count">装配题 {{ puzzleIdx + 1 }} / {{ puzzles.length }}</span>
      <span class="as-score">得分 <b class="as-score-num">{{ score }}</b></span>
      <button class="as-btn" @click="nextPuzzle">换一道</button>
      <button class="as-btn" @click="resetBoard">重置</button>
    </div>

    <div class="as-hint">{{ puzzle.hint }}</div>

    <div class="as-board">
      <!-- 零件库 -->
      <div
        class="as-library"
        :class="{ dragging: selectedId }"
        @dragover.prevent
        @drop.prevent="onDropLibrary"
      >
        <div class="as-zone-label">零件库<span class="as-zone-sub">拖拽 / 点选零件</span></div>
        <div class="as-pieces">
          <span
            v-for="p in library"
            :key="p.id"
            class="as-piece"
            :class="{ picked: selectedId === p.id }"
            draggable="true"
            @dragstart="onDragStart($event, p.id)"
            @click="tapPiece(p.id)"
          >{{ p.text }}</span>
          <span v-if="!library.length" class="as-piece empty">零件已全部上台</span>
        </div>
      </div>

      <!-- 装配台 -->
      <div class="as-bench">
        <div class="as-zone-label">装配台<span class="as-zone-sub">零件拖到这里</span></div>
        <div class="as-slots">
          <div
            v-for="(s, i) in puzzle.slots"
            :key="s.expect"
            class="as-slot"
            :class="{
              filled: placed[i],
              picked: selectedId && !placed[i],
              ok: attempted && placed[i] === s.expect,
              bad: attempted && placed[i] !== s.expect,
            }"
            @dragover.prevent
            @drop.prevent="onDropSlot($event, i)"
            @click="tapSlot(i)"
          >
            <small v-if="!placed[i]" class="as-slot-label">{{ s.label }}</small>
            <span v-else class="as-slot-text">{{ pieceById(placed[i])?.text }}</span>
          </div>
        </div>

        <div class="as-actions">
          <button class="as-btn primary" :disabled="success" @click="judge">启动装配</button>
          <span v-if="selectedId" class="as-tip">已选中零件,点击上方槽位装入</span>
        </div>
      </div>
    </div>

    <!-- 判定结果 + 运转动画 -->
    <div v-if="msg" class="as-msg" :class="success ? 'ok' : 'no'">{{ msg }}</div>
    <div v-if="success" class="as-running fade-in">
      <svg class="as-run-svg" viewBox="0 0 200 64">
        <g transform="translate(40 32)">
          <circle r="20" class="as-run-gear g1" />
          <circle r="20" fill="none" class="as-run-gear-ring g1" stroke-dasharray="4 3" />
        </g>
        <g transform="translate(86 32)">
          <circle r="13" class="as-run-gear g2" />
          <circle r="13" fill="none" class="as-run-gear-ring g2" stroke-dasharray="3 2.5" />
        </g>
        <g transform="translate(120 32)">
          <circle r="13" class="as-run-gear g3" />
          <circle r="13" fill="none" class="as-run-gear-ring g3" stroke-dasharray="3 2.5" />
        </g>
        <path d="M150 20 l-8 14 h6 l-4 12 12-18 h-6 z" class="as-run-bolt" />
        <circle cx="170" cy="46" r="4" class="as-run-dot d1" />
        <circle cx="186" cy="30" r="3" class="as-run-dot d2" />
      </svg>
      <span class="as-run-text">装对了,机器转起来了(你已经装好 {{ solved }} 台)</span>
    </div>
  </div>
</template>

<style scoped>
.assembly { display: flex; flex-direction: column; gap: 10px; }

.as-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.as-count { font-family: var(--mono); font-size: var(--fs-xs); color: var(--text-3); }
.as-score { font-size: var(--fs-xs); color: var(--text-2); margin-right: auto; }
.as-score-num { color: var(--warn); font-family: var(--mono); font-size: var(--fs-md); }
.as-btn {
  padding: 6px 14px; border-radius: 9px; cursor: pointer;
  background: var(--surface); border: 1px solid var(--line-strong);
  color: var(--text-2); font-family: inherit; font-size: var(--fs-xs);
  transition: all 0.2s var(--ease);
}
.as-btn:hover:not(:disabled) { border-color: var(--line-accent); color: var(--text); transform: translateY(-1px); }
.as-btn.primary {
  background: var(--accent-soft); border-color: var(--line-accent); color: var(--accent);
  font-weight: 600; padding: 9px 20px; font-size: var(--fs-sm);
}
.as-btn.primary:disabled { opacity: 0.55; cursor: default; }

.as-hint {
  padding: 8px 12px; border-radius: 9px; font-size: var(--fs-sm); color: var(--text-2);
  background: var(--surface-sunken); border: 1px dashed var(--line-strong);
}

.as-board { display: grid; grid-template-columns: 1fr 1.15fr; gap: 12px; }
@media (max-width: 720px) { .as-board { grid-template-columns: 1fr; } }

.as-library, .as-bench {
  border-radius: 12px; padding: 10px 12px 12px;
  background: var(--surface-sunken); border: 1px solid var(--line);
  min-height: 120px;
}
.as-library.dragging { border-color: var(--line-accent); }
.as-zone-label {
  font-size: var(--fs-2xs); color: var(--text-3); font-weight: 600;
  letter-spacing: 0.06em; margin-bottom: 8px;
  display: flex; justify-content: space-between; align-items: baseline;
}
.as-zone-sub { font-size: var(--fs-2xs); font-weight: 400; color: var(--text-4); }

.as-pieces { display: flex; flex-wrap: wrap; gap: 8px; }
.as-piece {
  padding: 7px 12px; border-radius: 9px; cursor: grab; user-select: none;
  background: var(--surface); border: 1px solid var(--line-accent);
  color: var(--text); font-size: var(--fs-sm); font-family: var(--mono);
  transition: all 0.2s var(--ease);
  touch-action: manipulation; /* 允许触摸点选而不触发滚动延迟 */
}
.as-piece:hover { border-color: var(--accent); transform: translateY(-1px); }
.as-piece.picked {
  background: var(--accent-soft); border-color: var(--accent);
  box-shadow: 0 0 10px var(--accent-soft); color: var(--accent); font-weight: 700;
}
.as-piece.empty { border-style: dashed; color: var(--text-3); background: transparent; cursor: default; font-family: inherit; }

.as-slots { display: flex; flex-direction: column; gap: 6px; }
.as-slot {
  min-height: 40px; border-radius: 9px; cursor: pointer;
  background: var(--surface); border: 1px dashed var(--line-strong);
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s var(--ease);
}
.as-slot.picked { border-color: var(--accent); background: var(--accent-soft); }
.as-slot.filled { border-style: solid; border-color: var(--line-accent); }
.as-slot-label { font-size: var(--fs-2xs); color: var(--text-4); letter-spacing: 0.08em; }
.as-slot-text {
  font-family: var(--mono); font-size: var(--fs-sm); color: var(--text); font-weight: 600;
  padding: 8px 12px;
}
.as-slot.ok { background: color-mix(in srgb, var(--success) 15%, transparent); border-color: var(--success); }
.as-slot.ok .as-slot-text { color: var(--success); }
.as-slot.bad { background: color-mix(in srgb, var(--danger) 12%, transparent); border-color: var(--danger); animation: asShake 0.35s var(--ease); }
.as-slot.bad .as-slot-text { color: var(--danger); }
@keyframes asShake { 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }

.as-actions { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.as-tip { font-size: var(--fs-xs); color: var(--accent); }

.as-msg { font-size: var(--fs-sm); font-weight: 600; }
.as-msg.ok { color: var(--success); }
.as-msg.no { color: var(--danger); }

.as-running { display: flex; align-items: center; gap: 12px; }
.as-run-svg { width: 200px; height: 64px; }
.as-run-gear { fill: var(--accent); opacity: 0.9; }
.as-run-gear-ring { stroke-width: 2.5; stroke: var(--accent-2); }
.as-run-gear, .as-run-gear-ring { transform-box: fill-box; transform-origin: center; }
.as-run-gear.g1 { animation: asSpin 3s linear infinite; }
.as-run-gear-ring.g1 { animation: asSpinRev 3s linear infinite; }
.as-run-gear.g2, .as-run-gear.g3 { fill: var(--accent-2); }
.as-run-gear.g2 { animation: asSpinRev 2s linear infinite; }
.as-run-gear-ring.g2 { animation: asSpin 2s linear infinite; stroke: var(--accent); }
.as-run-gear.g3 { animation: asSpin 2s linear infinite; }
.as-run-gear-ring.g3 { animation: asSpinRev 2s linear infinite; stroke: var(--accent); }
.as-run-bolt { fill: var(--warn); animation: asFlicker 0.8s steps(2) infinite; }
.as-run-dot { fill: var(--success); }
.as-run-dot.d1 { animation: asBlink 1s ease-in-out infinite; }
.as-run-dot.d2 { animation: asBlink 1.4s ease-in-out 0.4s infinite; }
.as-run-text { font-size: var(--fs-sm); color: var(--success); font-weight: 600; }
@keyframes asSpin { to { transform: rotate(360deg); } }
@keyframes asSpinRev { to { transform: rotate(-360deg); } }
@keyframes asFlicker { 50% { opacity: 0.35; } }
@keyframes asBlink { 50% { opacity: 0.3; } }
</style>
