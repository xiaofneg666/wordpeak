<script setup>
import { computed } from 'vue'

// 全年活跃度热力图(GitHub 风):纯 SVG,无图表库
// props.days: [{ date: 'YYYY-MM-DD', reviews, new_words }, ...]
const props = defineProps({
  days: { type: Array, default: () => [] },
})

// 5 档强度桶(基于 reviews + new_words)
function bucket(v) {
  if (v <= 0) return 0
  if (v <= 3) return 1
  if (v <= 7) return 2
  if (v <= 15) return 3
  return 4
}
const BUCKET_LABELS = ['无活动', '1-3', '4-7', '8-15', '16+']
const BUCKET_COLORS = [
  'var(--surface-sunken)',
  'color-mix(in srgb, var(--success) 22%, transparent)',
  'color-mix(in srgb, var(--success) 40%, transparent)',
  'color-mix(in srgb, var(--success) 60%, transparent)',
  'color-mix(in srgb, var(--success) 85%, transparent)',
]

// 计算网格行列:列 = 周(53 列),行 = 周一..周日(7 行);第一列对齐"本周一"往前推 52 周
const CELL = 12 // 单元格 px
const PAD = 2 // 单元格之间留 2px
const ROW_LABELS = ['一', '三', '五'] // 周一/三/五显示标签,避免拥挤
const MONTH_NAMES_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

// 把 days 数组转 Map,O(1) 查询
const dataMap = computed(() => {
  const m = new Map()
  for (const d of props.days || []) m.set(d.date, d)
  return m
})

// 计算列起始:从传入数据的最早日期所在那一周的周一倒推 52 周,得到 firstMonday
// 空数据时以今天为锚点渲染完整空网格(否则 viewBox 退化成 28x116 细条,
// 被 CSS min-width:100% 拉宽后等比放大成 4000+px 的巨卡)
const grid = computed(() => {
  // 用数组最后一项作为"今天所在的周"的参考;没数据就用真今天
  const ref = props.days.length
    ? new Date(props.days[props.days.length - 1].date + 'T00:00:00')
    : new Date()
  // 找 ref 所在周的周一:周一是 getDay()===1
  const refDayOfWeek = ref.getDay() // 0=Sun,1=Mon,...,6=Sat
  const offsetToMonday = (refDayOfWeek + 6) % 7 // Mon→0, Tue→1,..., Sun→6
  const lastMonday = new Date(ref.getTime() - offsetToMonday * 86400000)
  // 起始周 = lastMonday 倒推 52 周(共 53 列)
  const totalWeeks = 53
  const firstMonday = new Date(lastMonday.getTime() - (totalWeeks - 1) * 7 * 86400000)
  const cells = []
  for (let col = 0; col < totalWeeks; col++) {
    for (let row = 0; row < 7; row++) {
      // row=0 是周一,行 = 6 是周日
      const d = new Date(firstMonday.getTime() + (col * 7 + row) * 86400000)
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const data = dataMap.value.get(dateStr)
      const v = data ? (data.reviews || 0) + (data.new_words || 0) : 0
      cells.push({ col, row, dateStr, v, bucket: bucket(v), hasData: !!data })
    }
  }
  // 月份标签:每列首日的月份变化时插入一个 label(贴在该列顶部)
  const monthLabels = []
  let lastMonth = -1
  for (let col = 0; col < totalWeeks; col++) {
    const firstCellDate = new Date(firstMonday.getTime() + col * 7 * 86400000)
    const m = firstCellDate.getMonth()
    if (m !== lastMonth) {
      monthLabels.push({ col, month: MONTH_NAMES_EN[m] })
      lastMonth = m
    }
  }
  return { weeks: totalWeeks, cells, monthLabels, firstDate: firstMonday }
})

// 整体尺寸
const W = computed(() => grid.value.weeks * (CELL + PAD))
const H = computed(() => 7 * (CELL + PAD) + 18) // 顶部留 18px 给月份标签
</script>

<template>
  <div class="heatmap-wrap">
    <div class="heatmap-scroll">
      <svg
        class="heatmap-svg" :viewBox="`0 0 ${W + 28} ${H}`"
        :width="W + 28" :height="H"
        role="img" aria-label="全年活跃度热力图"
      >
        <!-- 行标签(一/三/五 周几) -->
        <g class="row-labels">
          <text v-for="(lbl, i) in ['', '一', '', '三', '', '五', '']" :key="i"
                :x="0" :y="18 + i * (CELL + PAD) + 9" class="rl">{{ lbl }}</text>
        </g>

        <!-- 月份标签 -->
        <g class="month-labels">
          <text v-for="ml in grid.monthLabels" :key="`m${ml.col}`"
                :x="28 + ml.col * (CELL + PAD)" y="12" class="ml">{{ ml.month }}</text>
        </g>

        <!-- 单元格(7 行 × N 列;第一列对齐"起始周"的周一) -->
        <g class="cells">
          <template v-for="cell in grid.cells" :key="`${cell.col}-${cell.row}`">
            <rect
              :x="28 + cell.col * (CELL + PAD)"
              :y="18 + cell.row * (CELL + PAD)"
              :width="CELL" :height="CELL" rx="3"
              :fill="BUCKET_COLORS[cell.bucket]"
              class="cell"
              :data-row="cell.row"
            >
              <title v-if="cell.hasData">
                {{ cell.dateStr }} · 复习 {{ cell.v }} 题
                <template v-if="cell.bucket >= 1">（{{ BUCKET_LABELS[cell.bucket] }}）</template>
              </title>
              <title v-else>{{ cell.dateStr }} · 无活动</title>
            </rect>
          </template>
        </g>
      </svg>
    </div>

    <!-- 图例 -->
    <div class="legend">
      <span class="legend-label">少</span>
      <span v-for="(c, i) in BUCKET_COLORS" :key="i" class="legend-cell" :style="{ background: c }" :title="BUCKET_LABELS[i]" />
      <span class="legend-label">多</span>
    </div>
  </div>
</template>

<style scoped>
.heatmap-wrap { display: flex; flex-direction: column; gap: 12px; }
.heatmap-scroll { overflow-x: auto; padding-bottom: 4px; }
.heatmap-svg { display: block; min-width: 100%; height: auto; }
.row-labels text, .rl { fill: var(--text-3); font-size: var(--fs-2xs); font-family: var(--mono); }
.month-labels text, .ml { fill: var(--text-3); font-size: var(--fs-2xs); font-family: var(--mono); letter-spacing: 0.04em; }
.cell {
  transform-box: fill-box; transform-origin: center;
  transition: transform 0.18s var(--ease-squish-2), filter 0.18s var(--ease);
}
/* 悬停 = 把这一天拿到灯下看:格子轻放大提亮(读数走原生 <title>) */
.cell:hover { transform: scale(1.25); filter: brightness(1.22) saturate(1.1); }
.legend { display: flex; align-items: center; gap: 4px; color: var(--text-3); margin-left: 28px; }
.legend-label { font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.08em; padding: 0 3px; }
.legend-cell { width: 11px; height: 11px; border-radius: 3px; transition: transform 0.15s var(--ease); }
.legend-cell:hover { transform: scale(1.25); }
</style>