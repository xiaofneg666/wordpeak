// 种子同步:data/words.json -> 活库。幂等:新词 INSERT,已有词内容有变化则 UPDATE。
// 用法:
//   node scripts/seed_sync.mjs                          # 走 .env(当前为 MySQL wordpeak)
//   WORDPEAK_DB=../wordpeak.db node scripts/seed_sync.mjs   # 显式指定 SQLite 归档库
import { initDb, db, DRIVER } from '../src/db.js'

const stats = await initDb()
const [{ n }] = await db.all('SELECT COUNT(*) n FROM words')
const fams = await db.all('SELECT family, COUNT(*) n FROM words GROUP BY family ORDER BY n DESC')
console.log(`[seed_sync][${DRIVER}] 播种统计:`, JSON.stringify(stats))
console.log(`[seed_sync][${DRIVER}] words 总数 ${n} / 家族 ${fams.length}`)
console.log('[seed_sync] 家族规模:', fams.map((r) => `${r.family}:${r.n}`).join(' '))
const uw = await db.get('SELECT COUNT(*) n FROM user_words')
console.log(`[seed_sync] user_words ${uw.n} 行(未动)`)
await db.close()
