<script setup>
// 语法家族关系网:SVG 自绘有向依赖图
// 主线:五大句型 → 时态 → 从句 → 非谓语 → 虚拟语气;旁支:特殊句型/语态/情态动词/比较
import { computed } from 'vue'

const props = defineProps({
  points: { type: Array, default: () => [] },
  states: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['select'])

// 主线五列(从左到右):列 x / 类别名
const MAIN_COLS = [
  { x: 20, category: '五大基本句型' },
  { x: 210, category: '时态' },
  { x: 400, category: '三大从句' },
  { x: 590, category: '非谓语动词' },
  { x: 780, category: '虚拟语气' },
]
const NODE_W = 150
const NODE_H = 32
const PITCH = 46

// 旁支:source 为主线列下标(箭头从该列底部发出)
// curve 为自定义 S 曲线(先竖后横绕行);默认竖直直线,同组第 2 个节点右绕 +140
const BRANCHES = [
  { category: '特殊句型', source: 0, x: 20, y0: 296 },
  { category: '语态', source: 1, x: 210, y0: 296 },
  { category: '情态动词', source: 1, x: 400, y0: 296, curve: true },
  { category: '比较', source: 2, x: 590, y0: 296, curve: true },
]

function pointsOf(category) {
  return props.points.filter((p) => p.category === category)
}

const colNodes = computed(() => {
  const maxH = 5 * PITCH - (PITCH - NODE_H) // 最高的列(5 节点)
  const topY = 46
  return MAIN_COLS.map((col, ci) => {
    const pts = pointsOf(col.category)
    const total = pts.length * PITCH - (PITCH - NODE_H)
    const start = topY + (maxH - total) / 2
    return {
      ...col,
      ci,
      nodes: pts.map((p, i) => ({
        point: p,
        x: col.x,
        y: start + i * PITCH,
        mastery: props.states[p.id]?.mastery ?? 0,
      })),
      bottomY: topY + (maxH + total) / 2,
    }
  })
})

function branchEdge(b, src, i) {
  const sx = src.x + NODE_W / 2
  const sy = src.bottomY + 4
  const tx = b.x + NODE_W / 2
  const ty = b.y0 + i * PITCH - 6
  if (b.curve) {
    // S 曲线:先竖降再横向绕行到目标节点顶部
    return `M ${sx} ${sy} C ${sx} ${sy + 29}, ${tx} ${ty - 32}, ${tx} ${ty}`
  }
  if (i > 0) {
    // 同组第 2 个节点:向右绕过前一个节点
    const off = 140
    const midY = (sy + ty + 6) / 2
    return `M ${sx} ${sy} C ${sx + off} ${midY}, ${sx + off} ${midY}, ${sx} ${ty}`
  }
  return `M ${sx} ${sy} L ${sx} ${ty}`
}

const branchNodes = computed(() => BRANCHES.flatMap((b) => {
  const pts = pointsOf(b.category)
  const src = colNodes.value[b.source]
  if (!src) return []
  return pts.map((p, i) => ({
    point: p,
    x: b.x,
    y: b.y0 + i * PITCH,
    mastery: props.states[p.id]?.mastery ?? 0,
    path: branchEdge(b, src, i),
  }))
}))

// 主线箭头(表头之间的横向箭头)
const mainArrows = computed(() =>
  MAIN_COLS.slice(0, -1).map((c, i) => ({ x1: c.x + NODE_W, x2: MAIN_COLS[i + 1].x })))

const headerY = 24
const NODE_TOP = 46

function nodeCls(m) {
  return m > 0.8 ? 'lit' : m > 0 ? 'half' : 'dormant'
}
</script>

<template>
  <div class="family">
    <div class="family-head">
      <!-- mono kicker 小标:与 machine-bench 的 SHOP FLOOR READOUT 同一记法 -->
      <div class="family-title">FAMILY GRID · 语法家族关系网</div>
      <div class="family-legend">
        <span class="fkey lit">学过的</span>
        <span class="fkey half">正在学的</span>
        <span class="fkey dormant">还没碰的</span>
        <span class="family-tip">点击节点进入对应语法机器</span>
      </div>
    </div>
    <div class="family-svg-wrap">
      <svg class="family-svg" viewBox="0 0 960 384" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="famArrowMain" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
          </marker>
          <marker id="famArrowBranch" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--text-3)" />
          </marker>
        </defs>

        <!-- 主线:表头 → 表头 的学习路径 -->
        <g v-for="(a, i) in mainArrows" :key="'ma' + i">
          <line
            :x1="a.x1 + 4" :y1="headerY" :x2="a.x2 - 6" :y2="headerY"
            stroke="var(--accent)" stroke-width="2.5"
            marker-end="url(#famArrowMain)" opacity="0.85"
          />
        </g>

        <!-- 列表头(主线类别) -->
        <g v-for="col in colNodes" :key="col.category">
          <text
            :x="col.x + NODE_W / 2" :y="headerY + 4"
            text-anchor="middle"
            class="fam-col-title"
          >{{ col.category }}</text>
          <!-- 类别下竖向导轨 -->
          <line
            :x1="col.x - 6" :y1="NODE_TOP + 2" :x2="col.x - 6" :y2="col.bottomY - 2"
            class="fam-rail"
          />
          <!-- 节点 -->
          <g
            v-for="n in col.nodes" :key="n.point.id"
            class="fam-node" :class="nodeCls(n.mastery)"
            @click="emit('select', n.point.id)"
          >
            <title>{{ n.point.title }} · 你已掌握 {{ Math.round(n.mastery * 100) }}%</title>
            <rect :x="n.x" :y="n.y" :width="NODE_W" :height="NODE_H" rx="9" class="fam-box" />
            <text :x="n.x + NODE_W / 2" :y="n.y + NODE_H / 2 + 4" text-anchor="middle" class="fam-text">{{ n.point.title }}</text>
          </g>
        </g>

        <!-- 旁支:虚线曲线 + 旁支节点 -->
        <g v-for="(b, i) in branchNodes" :key="'br' + i" class="fam-branch">
          <path :d="b.path" fill="none" class="fam-branch-line" marker-end="url(#famArrowBranch)" />
        </g>
        <g v-for="b in branchNodes" :key="b.point.id">
          <g class="fam-node" :class="nodeCls(b.mastery)" @click="emit('select', b.point.id)">
            <title>{{ b.point.title }} · 你已掌握 {{ Math.round(b.mastery * 100) }}%</title>
            <rect :x="b.x" :y="b.y" :width="NODE_W" :height="NODE_H" rx="9" class="fam-box" />
            <text :x="b.x + NODE_W / 2" :y="b.y + NODE_H / 2 + 4" text-anchor="middle" class="fam-text">{{ b.point.title }}</text>
          </g>
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
/* 容器与 machine-bench 同代语言:r-xl + hairline + 顶部 radial 微氛围(5%,只给图纸一束顶光,不更亮) */
.family {
  border: 1px solid var(--line); border-radius: var(--r-xl);
  background:
    radial-gradient(520px 240px at 10% -30%, color-mix(in srgb, var(--accent) 5%, transparent), transparent 65%),
    var(--surface);
  padding: 18px 20px 12px;
  margin-bottom: 24px; /* 与 bench/cats 同步 24px 节奏 */
}
.family-head { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
/* 标题升为 mono kicker 小标(与 bench-kicker 同一血统) */
.family-title { font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600; letter-spacing: 0.22em; color: var(--accent); }
.family-legend { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fkey { font-size: var(--fs-2xs); padding: 2px 9px; border-radius: 999px; border: 1px solid; }
/* lit = 掌握(>0.8)是「点亮」:图例与节点同金,与机器卡 mastered 金刻线同一语义 */
.fkey.lit { color: var(--gold); border-color: color-mix(in srgb, var(--gold) 45%, transparent); background: color-mix(in srgb, var(--gold) 8%, transparent); }
.fkey.half { color: var(--warn); border-color: var(--warn); background: color-mix(in srgb, var(--warn) 8%, transparent); }
.fkey.dormant { color: var(--text-3); border-color: var(--line-strong); }
.family-tip { font-size: var(--fs-2xs); color: var(--text-4); }

.family-svg-wrap { overflow-x: auto; }
.family-svg { width: 100%; min-width: 700px; display: block; }

.fam-col-title {
  font-size: var(--fs-sm); font-weight: 700;
  fill: var(--accent); letter-spacing: 0.06em;
}
.fam-rail { stroke: var(--line-strong); stroke-width: 3; stroke-linecap: round; opacity: 0.5; }

.fam-node { cursor: pointer; }
.fam-node .fam-box { fill: var(--surface); stroke: var(--line-strong); stroke-width: 1; transition: all 0.2s var(--ease); }
.fam-node .fam-text { font-size: var(--fs-xs); fill: var(--text-3); transition: fill 0.2s var(--ease); }
.fam-node.dormant .fam-box { stroke-dasharray: 4 3; }
.fam-node.half .fam-box { stroke: var(--warn); fill: color-mix(in srgb, var(--warn) 6%, transparent); }
.fam-node.half .fam-text { fill: var(--text-2); }
/* 已掌握节点:金描边 + 金内衬 + 金微光(mastered=金刻线的图内表达) */
.fam-node.lit .fam-box {
  stroke: var(--gold); fill: color-mix(in srgb, var(--gold) 10%, transparent);
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--gold) 25%, transparent));
}
/* 晴空下暗琥珀不做光晕(与星仪式光晕豁免同规则) */
[data-theme='light'] .fam-node.lit .fam-box { filter: none; }
.fam-node.lit .fam-text { fill: var(--text); font-weight: 600; }
.fam-node:hover .fam-box { stroke: var(--accent); filter: drop-shadow(0 0 6px var(--accent-soft)); }
.fam-node:hover .fam-text { fill: var(--text); }

.fam-branch-line { stroke: var(--line-strong); stroke-width: 1.5; stroke-dasharray: 5 4; }
</style>
