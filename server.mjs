#!/usr/bin/env node
// ============================================================================
// 词峰 WORDPEAK 一体化服务
//   一个 Node 进程同时提供:页面(frontend/dist 静态托管) + API(/api/*,复用后端)
//   同源请求,不再有 CORS / "后端没启动" 这类两进程模式的固有问题。
//
// 用法:
//   node server.mjs            按需构建前端 → 启动 → 自检 → 打开浏览器
//   node server.mjs --no-open   同上但不打开浏览器(桌面 App / 无头场景)
//   node server.mjs --stop     读取 PID 文件停止运行中的服务(词峰一键停止.bat 用)
//   PORT=3000 node server.mjs   指定首选端口(默认 5173,被占用时自动顺延 +10 次)
// ============================================================================
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, writeFileSync, rmSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { createApp } from './backend-node/src/app.js'
import { DRIVER } from './backend-node/src/db.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(ROOT, 'frontend', 'dist')
const PID_FILE = path.join(ROOT, '.server.pid')
const STAMP = path.join(DIST, '.wordpeak-stamp')
const args = new Set(process.argv.slice(2))

// ---------- 停止模式:按 PID 文件终止运行中的服务 ----------
function stopExisting() {
  if (!existsSync(PID_FILE)) { console.log('没有发现运行中的一体化服务(.server.pid 不存在)'); return }
  let pid = 0, port = ''
  try { ({ pid = 0, port = '' } = JSON.parse(readFileSync(PID_FILE, 'utf8'))) } catch { /* 损坏就清理 */ }
  rmSync(PID_FILE, { force: true })
  if (!pid) return
  try {
    process.kill(pid, 0) // 探活;不存在会抛
    process.kill(pid)
    console.log(`已发送停止信号 (PID ${pid}${port ? ` · 端口 ${port}` : ''})`)
  } catch {
    console.log(`服务已不在运行 (PID ${pid})`)
  }
}
if (args.has('--stop')) { stopExisting(); process.exit(0) }

// ---------- 前端构建:dist 缺失或源码比上次构建新 → 重新 build ----------
function newestMtime(dir, best = 0) {
  let m = best
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) m = Math.max(m, newestMtime(p, m))
    else m = Math.max(m, st.mtimeMs)
  }
  return m
}
function srcNewest() {
  let m = 0
  for (const d of ['frontend/src', 'frontend/public']) m = Math.max(m, newestMtime(path.join(ROOT, d), m))
  for (const f of ['frontend/index.html', 'frontend/vite.config.js', 'frontend/package.json'])
    m = Math.max(m, statSync(path.join(ROOT, f)).mtimeMs)
  return m
}
function ensureDist() {
  const built = existsSync(path.join(DIST, 'index.html'))
  const stamp = built && existsSync(STAMP) ? Number(readFileSync(STAMP, 'utf8')) || 0 : 0
  if (built && srcNewest() <= stamp) return
  console.log(built ? '⟳ 前端源码有更新，重新构建…' : '📦 首次运行，构建前端…(约 20 秒，之后直接秒开)')
  const r = spawnSync('npm', ['run', 'build'], { cwd: path.join(ROOT, 'frontend'), stdio: 'inherit', shell: true })
  if (r.status !== 0) { console.error('前端构建失败，请到 frontend/ 目录手动运行 npm run build 排查'); process.exit(1) }
  writeFileSync(STAMP, String(Date.now()))
}

// ---------- 组装应用:API + 静态页面 + SPA 回退 ----------
ensureDist()
const app = await createApp()
// 缓存策略:index.html 永远 no-cache(重建后旧缓存会去要已不存在的 hash 资产),
// /assets/* 文件名带内容 hash,可放心 immutable 一年;其余(图标/manifest)走默认协商缓存
app.use(express.static(DIST, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache')
    else if (filePath.split(path.sep).includes('assets'))
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  },
}))
app.use((req, res, next) => {
  // SPA 回退:非 /api 的 GET 一律回 index.html(hash 路由不需要服务端路由);入口同样 no-cache
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    // /assets/* 是内容 hash 资产,不存在就该 404:回 index.html 会让浏览器把一页
    // HTML 当 CSS/JS 解析(SW 换代时旧 hash 请求必现,排查时极具误导性)
    if (req.path.startsWith('/assets/')) return res.status(404).end()
    res.setHeader('Cache-Control', 'no-cache')
    return res.sendFile(path.join(DIST, 'index.html'))
  }
  next()
})
// 再兜一层错误:createApp 内的统一错误壳注册在它内部(早于上面的静态/SPA),
// 这里晚挂的中间件一旦抛错会落到 Express 默认 HTML 500,给 API 保持 {ok:false} 壳
app.use((err, req, res, next) => {
  console.error('[error]', err)
  if (res.headersSent) return next(err)
  if (req.path.startsWith('/api')) return res.status(500).json({ ok: false, error: String(err?.message || err) })
  res.status(500).send('Internal Server Error')
})

// ---------- 选端口:先探测(v4+v6 都要查,防止别的进程只占 IPv6 造成"同端口两个服务"的静默共存) ----------
const FIRST = Number(process.env.PORT) || 5173
async function portBusy(p) {
  // 任一协议栈上能连上即视为占用(不必是 HTTP 200)
  for (const host of ['127.0.0.1', '[::1]']) {
    try {
      const res = await fetch(`http://${host}:${p}/`, { signal: AbortSignal.timeout(700) })
      res.body?.cancel?.()
      return true
    } catch (e) {
      if (e.cause?.code === 'ECONNREFUSED') continue // 该栈没人,查另一个
      return true // 超时/其它网络错误:保守起见视为占用,避免撞车
    }
  }
  return false
}
function listenOn(port) {
  return new Promise((resolve, reject) => {
    // '::' 双栈监听:IPv4 + IPv6 都接(localhost 两种解析都能到达)
    const server = app.listen(port, '::')
    server.once('listening', () => resolve(server))
    server.once('error', reject)
  })
}
let server = null, port = FIRST
for (let i = 0; i <= 10 && !server; i++) {
  if (await portBusy(FIRST + i)) {
    if (i === 0) console.log(`端口 ${FIRST} 被占用(可能是开发服务器在跑)，尝试 ${FIRST + 1}…`)
    continue
  }
  try { server = await listenOn(FIRST + i); port = FIRST + i }
  catch (e) {
    if (e.code !== 'EADDRINUSE') throw e
  }
}
if (!server) { console.error('5173~5183 都被占用，请关闭占用的程序后重试'); process.exit(1) }
if (port !== FIRST) console.log(`⚠ 已换用端口 ${port}，注意浏览器地址栏要访问这个端口`)
writeFileSync(PID_FILE, JSON.stringify({ pid: process.pid, port, started: Date.now() }))

// ---------- 自检:API 通了才开浏览器 ----------
async function selfCheck() {
  for (let i = 0; i < 15; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/words`)
      if (res.ok) return true
    } catch { /* 服务刚起,稍候重试 */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}
if (!await selfCheck()) {
  console.error('服务已启动但 API 自检失败,请把本窗口的报错发出来排查')
} else if (!args.has('--no-open')) {
  const url = `http://localhost:${port}`
  const cmd = process.platform === 'win32' ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
    : process.platform === 'darwin' ? spawn('open', [url], { detached: true, stdio: 'ignore' })
    : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
  cmd.unref()
}

// ---------- 状态面板 ----------
const lan = Object.values(os.networkInterfaces()).flat()
  .find((i) => i.family === 'IPv4' && !i.internal)
console.log(`
╔══════════════════════════════════════════════════╗
║  词峰 WORDPEAK 已就绪 ✓                          ║
║──────────────────────────────────────────────────║
║  本机访问   http://localhost:${port < 10000 ? port + ' ' : port}              ║
${lan ? `║  局域网访问 http://${lan.address}:${port} (手机同 WiFi 可用) ║
` : ''}║──────────────────────────────────────────────────║
║  停止服务   关闭本窗口,或双击「词峰一键停止.bat」    ║
${DRIVER === 'mysql'
  ? `║  数据库     MySQL · ${(process.env.WORDPEAK_MYSQL_DATABASE ?? process.env.WORDVERSE_MYSQL_DATABASE ?? 'wordpeak')}          ║`
  : '║  数据文件   backend-node/wordpeak.db              ║'}
╚══════════════════════════════════════════════════╝`)

// 退出时清理 PID 文件(Ctrl+C / 关窗口 / 一键停止都会走到)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { rmSync(PID_FILE, { force: true }); process.exit(0) })
process.on('exit', () => { try { rmSync(PID_FILE, { force: true }) } catch { /* 已清 */ } })
