import { createApp } from 'vue'
import { createPinia } from 'pinia'
// 自托管字体,只取 latin/latin-ext 子集:默认入口(@fontsource/inter/400.css)会引入
// 全部语言字形(西里尔/希腊/越南…),一个中英学习产品永远用不到,却进 dist 和 SW 预缓存
// (IPA 音标字符 ŋ ʃ æ ð 等落在 latin-ext,必须保留)
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-ext-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-ext-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-ext-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/inter/latin-ext-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-ext-400.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import '@fontsource/jetbrains-mono/latin-ext-700.css'
import App from './App.vue'
import './styles.css'
import BlurText from './components/BlurText.vue'
import CountNum from './components/CountNum.vue'
import { message } from './ui'

const app = createApp(App)
// 全局动效组件(零依赖复刻,懒视图里随处可用,不必逐个 import):
// <BlurText text="回声谷"/> 逐字模糊入场;<CountNum :v="n" mono/> 数字滚动
app.component('BlurText', BlurText)
app.component('CountNum', CountNum)
// 全局兜底:组件 render/挂载期抛错默认会被吞掉(只剩 console),挂载中止后整页空白;
// 统一浮到 toast,让"页面突然空白"类问题有可见提示
app.config.errorHandler = (err, _instance, info) => {
  console.error('[WordPeak]', info, err)
  message.error('页面出了点问题，请刷新重试')
}
// dev 模式下注销残留 Service Worker:此前若曾在 5173 端口跑过生产构建并注册过 SW,
// 它的 precache 会劫持请求导致"后端连不上/资源过期"类灵异问题(生产不受影响,dev 从不注册)
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()))
    .catch(() => {})
}
// PWA 更新闭环:生产 SW 关了 skipWaiting/clientsClaim(vite.config 注释:避免直接接管
// 运行中的旧页面,旧代码懒加载旧 hash chunk 会 404),于是新构建的 SW 装好后停在
// waiting——只要标签页还开着就永远不接管,旧 precache 一直供旧资源,"源码改了页面
// 不变"就是这么来的。这里检测到 waiting SW 时弹更新条,用户点「刷新」发
// SKIP_WAITING 并整页刷新,版本切换由用户一次点击完成。
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  document.documentElement.dataset.build = '2026-10-19-swupdate2'
  let refreshing = false
  // clientsClaim 也关了:旧页面收不到 controllerchange,刷新由点击处的定时器兜底;
  // 此监听只在 SW 主动接管(swap 到 clientsClaim 配置)时生效,留着不亏
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    location.reload()
  })
  const ask = (reg) => {
    if (!reg.waiting || document.querySelector('.sw-update')) return
    const bar = document.createElement('div')
    bar.className = 'sw-update'
    bar.innerHTML = '<span>词峰有新版本已就绪</span><button type="button">刷新查看</button>'
    bar.querySelector('button').addEventListener('click', () => {
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' })
      setTimeout(() => location.reload(), 400)
    })
    document.body.appendChild(bar)
  }
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) return
    ask(reg) // 打开页面前就已有 waiting(上次部署后排队的)
    reg.addEventListener('updatefound', () => {
      const w = reg.installing
      if (!w) return
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) ask(reg)
      })
    })
    // 常开的标签页没有导航事件,SW 不会自动查更新;每小时主动查一次
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000)
  }).catch(() => {})
}
app.use(createPinia()).mount('#app')
