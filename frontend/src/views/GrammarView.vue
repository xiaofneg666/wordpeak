<script setup>
import { ref, computed, onActivated } from 'vue'
import HowToTrain from '../components/HowToTrain.vue'
import { useUniverse } from '../stores/universe'
import GrammarDetail from '../components/GrammarDetail.vue'
import GrammarFamilyGraph from '../components/GrammarFamilyGraph.vue'
import EmptyState from '../components/EmptyState.vue'

const store = useUniverse()
const openId = ref(null)

// 错题本深链:带着具体语法点进入,激活即展开讲解(数据未到位时 openId 先存着,加载完自然命中)
// KeepAlive 后 setup 只跑一次:深链消费放 onActivated,错题本「去练这个点」每次都命中
onActivated(() => {
  if (store.pendingGrammarId) { openId.value = store.pendingGrammarId; store.pendingGrammarId = null }
})

const point = computed(() => store.grammar.find((g) => g.id === openId.value))
const mastered = computed(() => store.grammar.filter((g) => (store.grammarStates[g.id]?.mastery ?? 0) > 0.8).length)

// 分类筛选:chip 可点(全部分类来自数据,不硬编码)
const catFilter = ref('all')
const categories = computed(() => [...new Set(store.grammar.map((g) => g.category).filter(Boolean))])
const grammarList = computed(() =>
  catFilter.value === 'all' ? store.grammar : store.grammar.filter((g) => g.category === catFilter.value))

function chipCls(m) { return m > 0.8 ? 'green' : m > 0.4 ? 'amber' : '' }
function barCls(m) { return m > 0.8 ? 'green' : m > 0.4 ? 'amber' : 'red' }

function ringStyle(m) {
  const pct = Math.round(Math.max(0, Math.min(1, m)) * 100)
  return {
    background: `conic-gradient(var(--accent) 0% ${pct}%, var(--surface-active) ${pct}% 100%)`,
  }
}
</script>

<template>
  <div class="view-scroll">
    <div class="view-inner fade-in">
      <div class="terr-head">
        <div class="terr-kicker">TERRITORY · GRAMMAR</div>
        <h2 class="terr-title"><BlurText text="语法机械城" as="span" /></h2>
        <div class="terr-latin">MACHINE CITY</div>
        <div class="terr-rule" aria-hidden="true" />
        <p class="terr-sub">
          每个语法点是一台机器，答题就是给它装配零件。答错的题会记进错题档案，连续答对才算结案。
        </p>
      </div>

      <!-- 怎么练才有效:方法论条(收起一行,展开步骤) -->
      <HowToTrain view="grammar" />
      <!-- 车间读数台:点阵仪器台上滚动总装读数(与回声谷/竞技场的台面同一语言) -->
      <div class="machine-bench dots-host">
        <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.22" />
        <div class="bench-meta">
          <div class="bench-kicker">SHOP FLOOR READOUT · 车间读数</div>
          <div class="ph-stats">
            <span class="ph-stat"><b><CountNum :v="mastered" mono /></b> 台已掌握</span>
            <span class="ph-stat"><b><CountNum :v="store.grammar.length" mono /></b> 台机器</span>
          </div>
        </div>
        <div class="bench-read">
          <!-- 装配率达标(≥80%):大读数与 bar 同升金——「点亮=金」 -->
          <div class="bench-pct" :class="{ gold: (mastered / (store.grammar.length || 1)) >= 0.8 }">
            <CountNum :v="Math.round((mastered / (store.grammar.length || 1)) * 100)" mono /><i>%</i>
          </div>
          <span class="bench-pct-label">全城装配率</span>
          <div class="bar bench-bar" :class="{ gold: (mastered / (store.grammar.length || 1)) >= 0.8 }">
            <i :style="{ width: `${Math.min(100, (mastered / (store.grammar.length || 1)) * 100)}%` }" />
          </div>
        </div>
      </div>

      <!-- 语法机器加载中:skeleton 占位 -->
      <template v-if="store.fetching">
        <div class="sk-graph skeleton" />
        <div class="grid cols-3">
          <div v-for="i in 3" :key="i" class="card sk-grammar-card">
            <div class="sk-card-row">
              <div class="skeleton sk-ring" />
              <div style="flex: 1">
                <div class="skeleton sk-line" :style="{ width: '52%' }" />
                <div class="skeleton sk-line" :style="{ width: '80%', marginTop: '10px', height: '18px' }" />
              </div>
            </div>
            <div class="skeleton sk-line" :style="{ width: '100%', height: '34px', marginTop: '6px' }" />
          </div>
        </div>
      </template>

      <!-- 无语法点:空态 -->
      <EmptyState
        v-else-if="!store.grammar.length"
        icon="静" title="机械城还没开工"
        desc="这里的语法机器都来自服务端——刷新一下通常就运过来了,若一直空着,晚点再来"
      />

      <template v-else>
        <!-- 家族关系网:主线依赖 + 旁支,点亮的机器可点击直达 -->
        <GrammarFamilyGraph
          :points="store.grammar"
          :states="store.grammarStates"
          @select="openId = $event"
        />

        <!-- 分类筛选:机械城的分区图纸,点 chip 只看该类机器 -->
        <template v-if="categories.length > 1">
          <div class="machine-hint">PICK A MACHINE · 分区图纸，点选只看该区机器</div>
          <div class="grammar-cats">
            <button
              class="rule-cat" :class="{ active: catFilter === 'all' }"
              @click="catFilter = 'all'"
            >全部</button>
            <button
              v-for="c in categories" :key="c"
              class="rule-cat" :class="{ active: catFilter === c }"
              @click="catFilter = c"
            >{{ c }}</button>
          </div>
        </template>

        <div class="grid cols-3 stagger">
        <button
          v-for="(g, gi) in grammarList" :key="g.id"
          class="card grammar-card hoverable"
          :class="{ mastered: (store.grammarStates[g.id]?.mastery ?? 0) > 0.8 }"
          @click="openId = g.id"
        >
          <div class="grammar-card-top">
            <!-- 高掌握(>0.8)= 点亮:环 conic 与读数换金(样式层接管,script 的 ringStyle 不动) -->
            <div class="mastery-ring" :class="{ lit: (store.grammarStates[g.id]?.mastery ?? 0) > 0.8 }" :style="ringStyle((store.grammarStates[g.id]?.mastery ?? 0))">
              <span class="mastery-pct"><CountNum :v="Math.round((store.grammarStates[g.id]?.mastery ?? 0) * 100)" mono /></span>
              <span class="mastery-unit">%</span>
            </div>
            <div style="flex: 1; min-width: 0">
              <div class="grammar-card-chips">
                <span class="chip cyan">{{ g.category }}</span>
                <span class="chip" :class="chipCls((store.grammarStates[g.id]?.mastery ?? 0))">
                  {{ (store.grammarStates[g.id]?.mastery ?? 0) > 0.8 ? '已掌握' : (store.grammarStates[g.id]?.mastery ?? 0) > 0 ? '正在学' : '还没碰' }}
                </span>
                <span class="machine-id" aria-hidden="true">M-{{ String(gi + 1).padStart(2, '0') }}</span>
              </div>
              <div class="grammar-card-title">{{ g.title }}</div>
            </div>
          </div>
          <!-- 公式图纸风 -->
          <div class="grammar-formula">
            <span class="formula-bar" /><span class="formula-text">{{ g.formula }}</span><span class="formula-bar" />
          </div>
          <div class="bar grammar-bar" :class="barCls((store.grammarStates[g.id]?.mastery ?? 0))">
            <i :style="{ width: `${Math.max(4, (store.grammarStates[g.id]?.mastery ?? 0) * 100)}%` }" />
          </div>
        </button>
      </div>
      </template>
    </div>

    <GrammarDetail
      v-if="point"
      :point="point"
      :mastery="store.grammarStates[point.id]?.mastery"
      @close="openId = null"
    />
  </div>
</template>

<style scoped>
/* 加载骨架 */
/* 骨架底距并入 24px 节奏(与成品 graph 一致,加载完不跳) */
.sk-graph { height: 120px; margin: 0 0 24px; }
.sk-grammar-card { display: flex; flex-direction: column; }
.sk-card-row { display: flex; gap: 18px; align-items: center; }
.sk-ring { width: 64px; height: 64px; border-radius: 50%; flex-shrink: 0; }
.sk-line { height: 12px; margin: 4px 0; }

.grammar-card { display: flex; flex-direction: column; gap: 14px; padding: 24px; text-align: left; }
.grammar-card-top { display: flex; gap: 18px; align-items: center; }
.grammar-card-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
.grammar-card-title {
  font-size: var(--fs-lg); font-weight: 600; letter-spacing: -0.01em; line-height: 1.3;
  color: var(--text);
}

.mastery-ring {
  position: relative; flex-shrink: 0;
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.mastery-ring::after {
  content: ''; position: absolute; inset: 4px; border-radius: 50%;
  background: var(--surface);
}
.mastery-pct {
  position: relative; z-index: 1;
  font-family: var(--mono); font-size: var(--fs-md); font-weight: 700; color: var(--text);
  font-variant-numeric: tabular-nums;
}
.mastery-unit {
  position: relative; z-index: 1;
  font-size: var(--fs-2xs); color: var(--text-3); margin-left: 1px;
}

.grammar-formula {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 8px;
  /* 虚线草稿感换 solid hairline:公式是「刻在」机器上的图纸,不是便签 */
  background: var(--surface-sunken); border: 1px solid var(--line);
}
.grammar-formula .formula-bar {
  flex: 1; height: 1px; background: linear-gradient(90deg, transparent, var(--line-strong), transparent);
}
.grammar-formula .formula-text {
  font-family: var(--mono); font-size: var(--fs-xs); color: var(--text-2);
  letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.grammar-bar { height: 4px; }

/* 分类筛选行(底距并入 24px 节奏:bench → graph → cats → cards 同一呼吸) */
.grammar-cats { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 24px; }
.rule-cat {
  padding: 5px 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line-strong); background: var(--surface);
  color: var(--text-2); font-size: var(--fs-xs); font-weight: 500; font-family: inherit;
  transition: all 0.2s var(--ease); white-space: nowrap;
}
.rule-cat:hover { border-color: var(--line-accent); color: var(--text); }
.rule-cat.active {
  background: var(--grad-accent); border-color: transparent; color: var(--on-accent);
  box-shadow: 0 2px 10px color-mix(in srgb, var(--accent) 30%, transparent);
}

/* BlurText 接管「语法机械城」入场:全局 terrRise 在本视图置空,避免双重动画 */
.terr-title { animation: none; }

/* ===== 车间读数台:点阵仪器台 + mono 总装读数(与竞技场 scene-head 同一台面语言) ===== */
.machine-bench {
  position: relative; overflow: hidden;
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 24px; flex-wrap: wrap;
  padding: 20px 24px 18px; margin: 0 0 24px;
  border: 1px solid color-mix(in srgb, var(--accent) 14%, var(--line));
  border-radius: var(--r-xl);
  background:
    radial-gradient(480px 260px at 92% -40%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 65%),
    var(--surface);
  animation: riseIn 0.5s var(--ease) both;
}
.bench-kicker {
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.22em; color: var(--accent); margin-bottom: 10px;
}
/* 读数 chip 坐在台面上,沉一档底色 */
.machine-bench .ph-stats { margin: 0; }
.machine-bench .ph-stat { background: var(--surface-sunken); }
.bench-read {
  position: relative;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
}
/* 大读数是「时刻」不是仪表:衬线大数字,读数感交给 tabular-nums 保住 */
.bench-pct {
  font-family: var(--serif); font-size: var(--fs-2xl); font-weight: 700; color: var(--text);
  font-variant-numeric: tabular-nums; line-height: 1;
}
/* CountNum 的 mono prop 在自己根节点设了 mono 字体,在此覆盖为衬线(不动模板 props) */
.bench-pct :deep(.count-num.mono) { font-family: var(--serif); }
/* 装配率达标:数字与 bar 同金(bar 用共享 .bar.gold,数字在此同色) */
.bench-pct.gold, .bench-pct.gold i { color: var(--gold); }
.bench-pct i { font-style: normal; font-size: var(--fs-base); color: var(--text-4); margin-left: 1px; }
.bench-pct-label { font-size: var(--fs-2xs); color: var(--text-3); letter-spacing: 0.06em; }
.bench-bar { width: 160px; height: 4px; border-radius: 2px; }
.bench-bar > i { border-radius: 2px; }

/* 分区图纸 hint(与回声谷 signal-hint 同语言) */
.machine-hint {
  font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.18em;
  color: var(--text-3); margin-bottom: 8px;
}

/* ===== 机器卡:铭牌 + 左缘刻线 + 掌握环弹入 ===== */
/* 机器铭牌:chips 行右端的 mono 编号,hover 升金——铭牌被「点亮」 */
.machine-id {
  margin-left: auto; align-self: center;
  font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.1em;
  color: var(--text-4); transition: color 0.25s var(--ease);
}
.grammar-card:hover .machine-id { color: var(--gold); }

/* 左缘刻线:与信号轨道/圣殿词星竖条同一血统;hover 立起 */
.grammar-card::after {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
  background: var(--accent); transform: scaleY(0); transform-origin: top;
  transition: transform 0.3s var(--ease-out-3), background 0.3s var(--ease);
}
.grammar-card:hover::after { transform: scaleY(1); }
/* 已掌握的机器 = 点亮的星:常亮金刻(词之心塔尖灯色;晴空换暗琥珀,与 dm-star 同规则) */
.grammar-card.mastered::after { background: var(--gold); transform: scaleY(1); }

.grammar-card-title { transition: color 0.25s var(--ease); }
.grammar-card:hover .grammar-card-title { color: var(--accent); }

/* 公式图纸:hover 时描线与文字各亮半档 */
.grammar-formula { transition: border-color 0.25s var(--ease); }
.grammar-card:hover .grammar-formula { border-color: var(--line-accent); }
.grammar-formula .formula-text { transition: color 0.25s var(--ease); }
.grammar-card:hover .formula-text { color: var(--text); }

/* 掌握环:随卡片级联弹入(squish),读数交给 CountNum 从 0 数上去 */
.mastery-ring {
  animation: ringPop 0.55s var(--ease-squish-2) calc(var(--i, 0) * 45ms + 0.15s) backwards;
}
/* 高掌握 = 点亮:环上就地把 --accent 重指为金(内联 conic 里的 var(--accent) 会取到),
   读数同步升金 + 金微光——与卡左缘金刻线同一语义(script 的 ringStyle 不动) */
.mastery-ring.lit { --accent: var(--gold); filter: drop-shadow(0 0 6px color-mix(in srgb, var(--gold) 28%, transparent)); }
.mastery-ring.lit .mastery-pct { color: var(--gold); }
/* 晴空下暗琥珀不做光晕(与星仪式 lr-lit-star 的豁免同规则) */
[data-theme='light'] .mastery-ring.lit { filter: none; }
@keyframes ringPop { from { transform: scale(0.6); opacity: 0; } }

@media (max-width: 768px) {
  .machine-bench { padding: 16px 16px 14px; gap: 16px; }
  .bench-read { align-items: flex-start; }
  .bench-bar { width: 120px; }
}
</style>
