// WordVerse Node 后端入口:Express + node:sqlite / mysql2/promise
// 契约与旧 FastAPI 版完全一致:响应壳 {ok, data|error},端口 8000,路径 /api/*
// 应用本体在 src/app.js(便于测试复用),这里只负责启动监听
import { createApp } from './src/app.js'

const PORT = Number(process.env.PORT) || 8000
const app = await createApp()
app.listen(PORT, () => {
  console.log(`WordVerse Node API listening on http://localhost:${PORT}`)
})