// Express 应用工厂:server.js(生产入口)与 tests/ 冒烟测试共用
// 路由注册、统一错误兜底都在这里;监听端口由调用方决定
import express from 'express'
import cors from 'cors'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initDb, DRIVER } from './db.js'
import { usersRouter } from './routes/users.js'
import { wordsRouter } from './routes/words.js'
import { reviewRouter } from './routes/review.js'
import { phonemesRouter } from './routes/phonemes.js'
import { grammarRouter } from './routes/grammar.js'
import { passagesRouter } from './routes/passages.js'
import { libraryRouter } from './routes/library.js'
import { contentRouter } from './routes/content.js'
import { phoneticsRouter } from './routes/phonetics.js'
import { readingRouter } from './routes/reading.js'
import { recommendRouter } from './routes/recommend.js'
import { planRouter } from './routes/plan.js'
import { aiRouter } from './routes/ai.js'
import { collectionsRouter } from './routes/collections.js'
import { writingRouter } from './routes/writing.js'
import { translateRouter } from './routes/translate.js'
import { diaryRouter } from './routes/diary.js'
import { explainRouter } from './routes/explain.js'

// .env 支持(零依赖手动解析):backend-node/.env 存在时读入注入;
// 已在系统环境里的变量不覆盖(系统配置优先)。AI 翻译 key 在这里配
const __dirname = dirname(fileURLToPath(import.meta.url))
// 测试进程置 WORDPEAK_NO_ENVFILE=1 时跳过(db.js 顶部的加载器同规则)
if ((process.env.WORDPEAK_NO_ENVFILE ?? process.env.WORDVERSE_NO_ENVFILE) !== '1') try {
  const envText = readFileSync(join(__dirname, '..', '.env'), 'utf8')
  for (const line of envText.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!m || line.trim().startsWith('#')) continue
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch { /* 没有 .env 是常态,静默跳过 */ }

export async function createApp() {
  let stats
  try {
    stats = await initDb()
  } catch (err) {
    // MySQL 连不上等致命错误:直接退出,避免半死状态
    console.error('[initDb] 初始化失败:', err)
    process.exit(1)
  }
  console.log(`[seed] driver=${DRIVER} words=+${stats.words} phonemes=+${stats.phonemes} grammar=+${stats.grammar} passages=+${stats.passages}`)

  const app = express()
  app.use(express.json())
  app.use(cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  }))

  const api = express.Router()
  api.use(usersRouter)
  api.use(wordsRouter)
  api.use(reviewRouter)
  api.use(phonemesRouter)
  api.use(grammarRouter)
  api.use(passagesRouter)
  api.use(libraryRouter)
  api.use(contentRouter)
  api.use(phoneticsRouter)
  api.use(readingRouter)
  api.use(recommendRouter)
  api.use(planRouter)
  api.use(aiRouter)
  api.use(collectionsRouter)
  api.use(writingRouter)
  api.use(translateRouter)
  api.use(diaryRouter)
  api.use(explainRouter)
  // 服务信息挂在 /api 下:'/' 让给一体化服务的 SPA 首页(nginx 模式 '/' 也从不走到后端)
  api.get('/', (_req, res) => res.json({ ok: true, data: { service: 'WordVerse Node API', version: '2.0' } }))
  app.use('/api', api)

  // 统一兜底:async 路由 rejection 也返回旧版风格的 {ok:false} 壳
  app.use((err, _req, res, _next) => {
    console.error('[error]', err)
    res.json({ ok: false, error: String(err?.message || err) })
  })

  return app
}
