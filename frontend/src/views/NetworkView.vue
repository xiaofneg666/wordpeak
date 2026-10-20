<script setup>
// 词汇网络 STELLAR NET —— 全库词共现图谱的可视化探索。
// 不是死记的清单,是"为什么会自然一起出现"的语义图。点开一个词,看哪些词跟它
// 在词峰里被同一篇 passages 反复提到。自由探索比列清单更能学——这是「不为什么地游荡」
// 把"我应该学什么"的压力转成"我好奇这两颗星为什么连着"。
import { computed, onActivated, ref } from 'vue'
import ForceGraph from '../components/ForceGraph.vue'
import WordPanel from '../components/WordPanel.vue'
import HowToTrain from '../components/HowToTrain.vue'
import { useUniverse } from '../stores/universe'

const store = useUniverse()
const query = ref('')
const filterMode = ref('all') // all | learned | unlearned

// 网络数据(60s 内复用内存)
const data = computed(() => store.network)

// 搜索:命中节点 id 集合(只对当前可见节点生效)
const matchIds = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q || !data.value.nodes.length) return []
  return data.value.nodes
    .filter((n) => n.word.toLowerCase().includes(q) || n.root.toLowerCase().includes(q)
      || (n.meaning || '').toLowerCase().includes(q))
    .map((n) => n.id)
})

// 当前选中的家族根(点节点高亮其家族)
const highlightRoot = computed(() => {
  const w = store.selectedWordId
  if (!w || !data.value.nodes.length) return ''
  const node = data.value.nodes.find((n) => n.id === w)
  return node?.root || ''
})

// 高亮家族的词统计(信息签:把「这是哪个家族 / 多少词 / 掌握多少 / 有没有欠复习」摆在画面上)
const highlightInfo = computed(() => {
  const r = highlightRoot.value
  if (!r) return null
  const list = data.value.nodes.filter((n) => n.root === r)
  const mastered = list.filter((n) => (n.retrievability ?? 0) > 0.85).length
  const due = list.filter((n) => n.retrievability != null && n.retrievability < 0.6).length
  const meaning = list[0]?.meaning?.split(/[,，;；]/)[0] || '—'
  return { root: r, total: list.length, mastered, due, meaning, sample: list.slice(0, 4).map((n) => n.word) }
})

// 已学 / 全部 / 未学 chip 计数
const learnedCount = computed(() => data.value.nodes.filter((n) => n.retrievability != null).length)

const allCount = computed(() => data.value.nodes.length)
const edgesCount = computed(() => data.value.edges.length)

onActivated(() => {
  store.loadNetwork()
})
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner fade-in">
      <div class="terr-head">
        <div class="terr-kicker">TERRITORY · NETWORK</div>
        <h2 class="terr-title"><BlurText text="词汇网络" as="span" /></h2>
        <div class="terr-latin">STELLAR NET</div>
        <div class="terr-rule" aria-hidden="true" />
        <p class="terr-sub">
          {{ store.words.length }} 个词 · 40 个家族 · 一张语义图谱。点开一个词,看看哪些词跟它「本来就该一起出现」。同族靠家族引力自然成团,跨族共现是同一篇 passages 反复提到的伙伴。
        </p>
      </div>

      <!-- 怎么练才有效:方法论条 -->
      <HowToTrain view="network" />

      <!-- 控件台:搜索 / 筛选 / 全网读数(mono 仪器语言) -->
      <div class="signal-hint">OBSERVATORY BENCH · 搜索 / 筛选 / 全网读数</div>
      <div class="net-controls">
        <input
          v-model="query"
          class="net-search"
          placeholder="搜词、词根或释义 · 例如 inspect / spect / 检查"
        />
        <div class="net-chips">
          <button class="net-chip" :class="{ active: filterMode === 'all' }" @click="filterMode = 'all'">
            全亮 <em>{{ allCount }}</em>
          </button>
          <button class="net-chip" :class="{ active: filterMode === 'learned' }" @click="filterMode = 'learned'">
            已学 <em>{{ learnedCount }}</em>
          </button>
          <button class="net-chip" :class="{ active: filterMode === 'unlearned' }" @click="filterMode = 'unlearned'">
            未学 <em>{{ allCount - learnedCount }}</em>
          </button>
        </div>
        <div class="net-stat">
          <CountNum :v="allCount" mono /> 词 <i>·</i> <CountNum :v="edgesCount" mono /> 跨族共现边
        </div>
      </div>

      <!-- 加载:织网仪式(点阵虚空 + 三颗四芒星脉动,与 boot 引力捕获同一语言) -->
      <div v-if="store.network.loading && !data.nodes.length" class="net-loading dots-host">
        <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.22" />
        <div class="nl-weave" aria-hidden="true"><i /><i /><i /></div>
        <div class="nl-kicker">WEAVING · 编织星网</div>
        <p class="nl-text">正在把词根家族织成一张网…</p>
      </div>
      <!-- 失败:星停摆、直说断连,不装作还在加载 -->
      <div v-else-if="!data.nodes.length" class="net-loading dots-host">
        <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.22" />
        <div class="nl-weave is-off" aria-hidden="true"><i /><i /><i /></div>
        <div class="nl-kicker is-off">SIGNAL LOST · 信号未达</div>
        <p class="net-empty">这张网暂时拉不过来——网络或服务没连上，稍后再试一次。</p>
        <p class="net-empty-hint">点下面重试一次；如果一直这样，说明服务端在休息。</p>
        <button class="btn small" @click="store.loadNetwork(true)">重新拉一次网 →</button>
      </div>

      <!-- 主图 + 当前家族信息签(画布右上) -->
      <div v-show="data.nodes.length" class="net-stage">
        <ForceGraph
          :nodes="data.nodes"
          :edges="data.edges"
          :meta="data.meta"
          :highlight-root="highlightRoot"
          :match-ids="matchIds"
          :filter-mode="filterMode"
        />

        <!-- 选中词的信息签:家族、词数、掌握、欠复习、推荐入口 -->
        <Transition name="net-info">
          <div v-if="highlightInfo && !store.selectedWordId" class="net-info-card cascade">
            <div class="nic-kicker">CURRENT FAMILY · 当前高亮</div>
            <div class="nic-root">{{ highlightInfo.root.toUpperCase() }}-</div>
            <div class="nic-meaning">{{ highlightInfo.meaning }}</div>
            <div class="nic-stats">
              <span class="chip dim">{{ highlightInfo.total }} 词</span>
              <span class="chip green">{{ highlightInfo.mastered }} 已掌握</span>
              <span v-if="highlightInfo.due" class="chip amber">{{ highlightInfo.due }} 待复习</span>
            </div>
            <div class="nic-words">
              <span v-for="w in highlightInfo.sample" :key="w" class="nic-word">{{ w }}</span>
              <span v-if="highlightInfo.total > highlightInfo.sample.length" class="nic-word nic-more">+{{ highlightInfo.total - highlightInfo.sample.length }}</span>
            </div>
            <div class="nic-actions">
              <button class="btn small primary" @click="store.openFamily(highlightInfo.root)">看家族详情 →</button>
            </div>
          </div>
        </Transition>
      </div>

      <!-- 点节点开词卡(与圣殿同一张卡) -->
      <WordPanel v-if="store.selectedWordId" />
    </div>
  </div>
</template>

<style scoped>
/* BlurText 接管「词汇网络」入场:全局 terrRise 在本视图置空,避免双重动画 */
.terr-title { animation: none; }
/* hint 呼吸位:贴 8px 网格 */
.signal-hint { margin-bottom: 8px; }

/* ===== 控件台:仪器栏(搜索 / 筛选 / 全网读数) ===== */
.net-controls {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin: 0 0 16px; padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: color-mix(in srgb, var(--surface) 72%, transparent);
}
.net-search {
  flex: 1; min-width: 220px; max-width: 420px;
  padding: 9px 14px; border-radius: var(--r-md);
  font-size: var(--fs-sm); font-family: inherit;
  background: var(--surface-sunken);
  border: 1px solid var(--line); color: var(--text); outline: none;
  transition: border-color 0.2s var(--ease), box-shadow 0.2s var(--ease), background 0.2s var(--ease);
}
.net-search::placeholder { color: var(--text-4); }
.net-search:focus {
  border-color: var(--accent); background: var(--surface);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.net-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.net-chip {
  background: transparent; border: 1px solid var(--line-strong); border-radius: 999px;
  padding: 6px 14px; font-size: var(--fs-xs); color: var(--text-2); cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: baseline; gap: 6px;
  transition: all 0.2s var(--ease);
}
.net-chip em { font-style: normal; font-family: var(--mono); font-size: var(--fs-2xs); color: var(--text-3); font-variant-numeric: tabular-nums; }
.net-chip:hover { color: var(--text); border-color: var(--line-accent); background: var(--accent-soft); }
.net-chip.active { color: var(--accent); border-color: var(--line-accent); background: var(--accent-soft); }
.net-chip.active em { color: var(--accent); }
/* 全网读数:mono,数字走 CountNum 滚入 */
.net-stat {
  margin-left: auto; display: inline-flex; align-items: baseline; gap: 4px;
  font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.06em;
  color: var(--text-3); font-variant-numeric: tabular-nums; white-space: nowrap;
}
.net-stat i { font-style: normal; color: var(--text-4); margin: 0 3px; }
.net-stat .count-num { color: var(--text); font-weight: 600; font-size: var(--fs-base); }

/* ===== 加载 / 失败:织网仪式(点阵虚空 + 三颗四芒星脉动) ===== */
.net-loading {
  position: relative; overflow: hidden;
  height: 420px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  border: 1px dashed var(--line-strong); border-radius: var(--r-xl); color: var(--text-3);
  background: color-mix(in srgb, var(--surface) 40%, transparent);
}
.nl-weave { display: flex; gap: 14px; align-items: center; height: 18px; }
.nl-weave i {
  width: 12px; height: 12px; background: var(--accent); opacity: 0.4;
  clip-path: polygon(50% 0, 58% 42%, 100% 50%, 58% 58%, 50% 100%, 42% 58%, 0 50%, 42% 42%);
  animation: nlPulse 1.5s var(--ease-in-out-3) infinite;
}
.nl-weave i:nth-child(2) { animation-delay: 0.2s; }
.nl-weave i:nth-child(3) { animation-delay: 0.4s; }
@keyframes nlPulse {
  0%, 100% { opacity: 0.35; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.3); }
}
.nl-weave.is-off i { animation: none; background: var(--text-4); opacity: 0.3; transform: none; }
.nl-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.32em; color: var(--accent); opacity: 0.85;
}
.nl-kicker.is-off { color: var(--danger); opacity: 0.8; }
.nl-text, .net-empty { font-size: var(--fs-sm); color: var(--text-2); }
.net-empty-hint { font-size: var(--fs-xs); color: var(--text-3); }

/* ===== 主图舞台:星图取景框 =====
   ForceGraph 容器需要明确高度,不给它就 0
   (min-height 用 clamp:矮窗口/横屏不再被 540px 硬下限撑破布局) */
.net-stage {
  width: 100%; height: calc(100vh - 360px); min-height: clamp(320px, 55vh, 540px); max-height: 760px;
  border: 1px solid var(--line-strong); border-radius: var(--r-xl); overflow: hidden;
  background:
    radial-gradient(720px 420px at 50% -10%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 70%),
    linear-gradient(180deg, color-mix(in srgb, var(--bg) 96%, transparent), color-mix(in srgb, var(--bg-2) 92%, transparent));
  position: relative;
  box-shadow: var(--shadow-md);
}
/* 取景框角刻线:星图 Viewport 的四角刻线,细线不加发光 */
.net-stage::before, .net-stage::after {
  content: ''; position: absolute; z-index: 3; pointer-events: none;
  width: 14px; height: 14px; border: 0 solid var(--line-accent); opacity: 0.9;
}
.net-stage::before { top: 10px; left: 10px; border-top-width: 1px; border-left-width: 1px; }
.net-stage::after { bottom: 10px; right: 10px; border-bottom-width: 1px; border-right-width: 1px; }

/* ===== 当前家族信息签(画布右上,玻璃 + 左缘 accent 竖条 + 子项 cascade 级联) ===== */
.net-info-card {
  position: absolute; top: 16px; right: 16px; z-index: 6;
  width: 248px; padding: 16px 16px 14px 18px;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  border: 1px solid var(--line-strong); border-radius: var(--r-lg);
  box-shadow: var(--shadow-scene);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
}
.net-info-card::before {
  content: ''; position: absolute; left: 0; top: 12px; bottom: 12px; width: 2px;
  background: var(--accent); border-radius: 0 2px 2px 0;
}
.nic-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.32em; color: var(--accent); margin-bottom: 8px;
}
/* 词根:星图命名式衬线(与圣殿家族标签同一语言) */
.nic-root {
  font-family: var(--serif);
  font-size: var(--fs-2xl); font-weight: 600; letter-spacing: 0.12em;
  color: var(--text); line-height: 1.1;
}
.nic-meaning { font-size: var(--fs-xs); color: var(--text-3); margin-top: 4px; line-height: 1.5; }
.nic-stats { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 12px; }
.nic-words { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 4px; }
.nic-word {
  font-family: var(--mono); font-size: var(--fs-2xs); color: var(--text-2);
  padding: 2px 8px; background: var(--surface-sunken);
  border: 1px solid var(--line); border-radius: var(--r-xs);
}
.nic-word.nic-more { color: var(--text-3); }
.nic-actions { margin-top: 12px; }
.nic-actions .btn { width: 100%; justify-content: center; }
.net-info-enter-active, .net-info-leave-active { transition: opacity 0.3s var(--ease-out-3), transform 0.3s var(--ease-out-3); }
.net-info-enter-from, .net-info-leave-to { opacity: 0; transform: translateX(10px); }

@media (max-width: 768px) {
  .net-controls { padding: 8px; gap: 8px; }
  .net-search { min-width: 100%; max-width: none; flex-basis: 100%; }
  .net-stat { margin-left: 0; }
  .net-info-card { width: 204px; top: 10px; right: 10px; padding: 12px 12px 10px 14px; }
  .nic-root { font-size: var(--fs-xl); }
}
</style>
