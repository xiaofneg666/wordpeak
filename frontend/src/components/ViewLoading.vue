<template>
  <div class="view-loading dots-host">
    <span class="dots-decor dots-fade" aria-hidden="true" style="--dots-o:.25" />
    <div class="vl-stage" aria-hidden="true">
      <span class="dm-star vl-star" />
    </div>
    <div class="vl-read">STELLAR ALIGNMENT</div>
    <div class="vl-zh">观星中 · 模块正在入轨…</div>
  </div>
</template>

<style scoped>
/* 懒加载视图的加载占位:配合 App.vue 的 lazyView 使用。
   裸 spinner 升格为「观星中」的等待仪式:一颗四芒星缓浮(--animation-float)
   + mono 读数 + 轻点阵。全程只有一个慢动画,不喧哗。 */
.view-loading {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; gap: 10px;
  align-items: center; justify-content: center;
}
.vl-stage {
  height: 28px;
  animation: var(--animation-float);
}
.vl-star {
  width: 20px; height: 20px;
  background: var(--accent); opacity: 0.85;
  animation: vlTwinkle 3.6s var(--ease-in-out-3) infinite;
}
@keyframes vlTwinkle { 0%, 100% { opacity: 0.65 } 50% { opacity: 1 } }
.vl-read {
  margin-top: 8px;
  font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 600;
  letter-spacing: 0.34em; color: var(--text-3);
}
.vl-zh { font-size: var(--fs-xs); color: var(--text-3); letter-spacing: 0.06em; }
</style>
