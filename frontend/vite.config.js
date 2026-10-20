import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// PWA manifest 定义(VitePWA 构建期与 dev 中间件共用一份,别处只改这里)
const PWA_MANIFEST = {
  name: '词峰 WORDPEAK',
  short_name: '词峰',
  description: '3D 沉浸式英语学习宇宙',
  theme_color: '#F7F5F0',
  background_color: '#F7F5F0',
  display: 'standalone',
  start_url: '/',
  icons: [
    { src: '/logo-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ],
}

// dev 专用中间件:/manifest.webmanifest 直接回合法 JSON(不启用 dev SW,避免开发期缓存捣乱)。
// 没有它,Vite 把未知路径回退成 index.html,浏览器按 manifest 解析 HTML → 控制台 Syntax error 刷屏
function devManifest() {
  return {
    name: 'dev-manifest',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url.split('?')[0] === '/manifest.webmanifest') {
          res.setHeader('Content-Type', 'application/manifest+json')
          res.end(JSON.stringify(PWA_MANIFEST))
          return
        }
        next()
      })
    },
  }
}

// PWA:桌面安装 + 离线可浏览/查词
//   - 知识类 API(只读 GET)走 NetworkFirst 1 天缓存;离线仍能浏览词库/语法/语料
//   - 静态资源全 precache(JS/CSS/字体/SVG),首次安装包体较大但加载瞬时
//   - registerType:'autoUpdate' — 新版本自动接管,无需用户手动刷新
export default defineConfig({
  plugins: [
    vue(),
    devManifest(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      // 用 'script' 显式注入 registerSW.js,而不是 'auto':'auto'+autoUpdate 会被插件强制
      // 覆盖 workbox.skipWaiting/clientsClaim 为 true(运行中页面被新版 SW 接管 → 旧 hash
      // chunk 404 → 全站 ViewError)。本项目本来就走的脚本注入,'script' 行为不变。
      injectRegister: 'script',
      includeAssets: ['*.png'],
      manifest: PWA_MANIFEST,
      workbox: {
        // 新 SW 不抢跑:默认 skipWaiting+clientsClaim=true 会在旧标签页运行中直接接管,
        // 而运行中的旧应用仍按旧文件名懒加载 chunk → 新构建里已不存在 → 404 → 各视图全挂 ViewError。
        // 关掉两者:新版本等所有标签页关闭后自然接管,运行中的页面始终由同版本 SW 一致地供数。
        skipWaiting: false,
        clientsClaim: false,
        // 静态资源(JS/CSS/SVG/woff2/HTML)全 precache;生产 hash 文件名,无需手动列清单
        globPatterns: ['**/*.{js,css,svg,woff2,html}'],
        // SPA fallback:任意未注册路径回 index.html(Vue hash 路由不产生新 path 请求)
        navigateFallback: 'index.html',
        // 只缓存知识类 GET 接口(数据静态,1 天过期);POST 类答题路径不进 cache,直接报后端不可达
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /^\/api\/(words|phonemes|grammar|passages|tips|books|roadmap|phonetics\/pairs|phonetics\/rules)$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'wordpeak-knowledge-api',
              expiration: { maxEntries: 32, maxAgeSeconds: 86400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  // 手切 chunk：three.js 单独拆出(大且只在词汇星系用到,缓存友好);naive-ui 也是大块
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          naive: ['naive-ui'],
        },
      },
    },
  },
  // dev 代理:前端一律请求同源 /api,由 vite 转发到本机后端 —— 免 CORS(后端白名单只有 5173)、
  // 免浏览器代理拦截 localhost、端口被占自动顺延时(5174/5175…)前端代码无需感知。生产同理由 nginx / server.mjs 反代。
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})