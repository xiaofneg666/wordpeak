<script setup>
// 懒加载视图加载失败兜底(dev server 重启后旧标签页 chunk 404、发版后旧 hash chunk 失效等)
// 重试 = 派发 wv:retryView,App.vue 收到后强制换 key 重挂载 → 重新发起 import
// 第二次重试改为整页刷新:旧 hash chunk 在磁盘上已不存在,重挂载只会再 404 一次,
// 刷新拉到新 index.html + 新 hash 模块才能真正自愈
let retried = false
function retry() {
  if (retried) { location.reload(); return }
  retried = true
  window.dispatchEvent(new CustomEvent('wv:retryView'))
}
</script>

<template>
  <div class="view-error">
    <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
      <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
        fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <div class="h-section">模块没加载出来</div>
    <p class="ve-sub">可能是网络波动或服务刚重启，重试一下就好。</p>
    <button class="btn primary" @click="retry">重试</button>
  </div>
</template>

<style scoped>
.view-error {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; gap: 10px;
  align-items: center; justify-content: center;
  color: var(--text-3);
}
.view-error svg { color: var(--warn); }
.ve-sub { margin: 0; font-size: var(--fs-sm); }
</style>
