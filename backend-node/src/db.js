// 数据访问层:统一异步 DAO + 双驱动(node:sqlite / MySQL via mysql2/promise)
// 路由层只需 await db.X(...) 即可,不感知驱动;方言差异(INSERT IGNORE / 索引语法)在 DAO 内消化。
//
// 驱动判定:WORDPEAK_DB === 'mysql' → MySQL;其它任何值(含未设置 / 'sqlite' / 临时路径)→ SQLite。
// 这保证本地 dev 与 node:test 零修改走 SQLite 路径,MySQL 仅在 docker-compose 中显式启用。
import { DatabaseSync } from 'node:sqlite'
import mysql from 'mysql2/promise'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { migrateSm2ToFsrs } from './srs.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.join(__dirname, '..', 'data')

// .env 注入(与 app.js 同一套零依赖解析,规则一致:已有系统变量不覆盖)。
// db.js 的驱动判定在 import 期执行,而 app.js 的加载发生在其后 —— 必须在这里
// 先读 .env,createApp 里那份才来得及;测试进程显式设的 WORDPEAK_DB 临时路径因此不受影响。
// 测试进程可置 WORDPEAK_NO_ENVFILE=1 完全隔离 .env(explain/api 测试要验证无 key 的本地降级)。
if ((process.env.WORDPEAK_NO_ENVFILE ?? process.env.WORDVERSE_NO_ENVFILE) !== '1') try {
  for (const line of readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch { /* 没有 .env 是常态,静默跳过 */ }

// 品牌统一:配置前缀以 WORDPEAK_* 为准;旧 WORDVERSE_* 自动映射,现有 .env 不必立刻改
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith('WORDVERSE_')) continue
  const next = 'WORDPEAK_' + key.slice('WORDVERSE_'.length)
  if (process.env[next] === undefined) process.env[next] = value
}

const DRIVER = process.env.WORDPEAK_DB === 'mysql' ? 'mysql' : 'sqlite'

// ---- 驱动配置 ----
const sqliteConfig = () => {
  const DB_PATH = process.env.WORDPEAK_DB && process.env.WORDPEAK_DB !== 'mysql'
    ? path.resolve(process.env.WORDPEAK_DB)
    : path.join(__dirname, '..', 'wordpeak.db')
  return DB_PATH
}
const mysqlConfig = () => ({
  host: process.env.WORDPEAK_MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.WORDPEAK_MYSQL_PORT || 3306),
  user: process.env.WORDPEAK_MYSQL_USER || 'root',
  password: process.env.WORDPEAK_MYSQL_PASSWORD || '',
  database: process.env.WORDPEAK_MYSQL_DATABASE || 'wordpeak',
  connectionLimit: Number(process.env.WORDPEAK_MYSQL_POOL || 8),
})

// ---- 行规范化:把 mysql2 默认 Date 对象 / ISO 字符串统一成 routes 期望的格式 ----
// SQLite/MySQL 'YYYY-MM-DD HH:MM:SS'(DATETIME 默认 → 字符串)→ 'YYYY-MM-DDTHH:MM:SS'
// DATE 'YYYY-MM-DD' → 保持原样(代码里也用 'YYYY-MM-DD' 直接比较)
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
function normRow(row) {
  if (!row || typeof row !== 'object') return row
  const out = {}
  for (const k of Object.keys(row)) {
    const v = row[k]
    if (typeof v === 'string' && DATETIME_RE.test(v)) out[k] = v.replace(' ', 'T')
    else out[k] = v
  }
  return out
}
const normRows = (rows) => Array.isArray(rows) ? rows.map(normRow) : []

// node:sqlite 不接受 boolean 绑定 → 统一转 0/1(mysql2 也是)
const fix = (params) => params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p))

// ---- SQL 方言收敛:路由层只写 SQL 主体,前缀由 DAO 改 ----
function insertIgnoreSql(sql) {
  // 把 'INSERT INTO ...' 替换为各驱动的等价语句(SQLite: OR IGNORE;MySQL: IGNORE)
  return DRIVER === 'mysql'
    ? sql.replace(/^\s*INSERT\s+INTO/i, 'INSERT IGNORE INTO')
    : sql.replace(/^\s*INSERT\s+INTO/i, 'INSERT OR IGNORE INTO')
}

// ---- DAO 工厂:同形态、async-first ----
function buildSqliteDao() {
  const DB_PATH = sqliteConfig()
  const raw = new DatabaseSync(DB_PATH)
  raw.exec('PRAGMA journal_mode = WAL;')
  raw.exec('PRAGMA foreign_keys = ON;') // node:sqlite 默认 OFF;开启以支持 collections ON DELETE CASCADE
  const prep = (sql) => {
    const s = raw.prepare(sql)
    return {
      run: (...p) => s.run(...fix(p)),
      get: (...p) => { const r = s.get(...fix(p)); return r === undefined ? undefined : normRow(r) },
      all: (...p) => normRows(s.all(...fix(p))),
    }
  }
  return {
    driver: 'sqlite',
    close: () => raw.close(),
    exec: async (sql) => { raw.exec(sql) },
    run: async (sql, ...params) => {
      const r = raw.prepare(sql).run(...fix(params))
      return { changes: r.changes ?? 0, lastInsertRowid: Number(r.lastInsertRowid), insertId: Number(r.lastInsertRowid) }
    },
    get: async (sql, ...params) => {
      const r = raw.prepare(sql).get(...fix(params))
      return r === undefined ? undefined : normRow(r)
    },
    all: async (sql, ...params) => normRows(raw.prepare(sql).all(...fix(params))),
    // prepare() 返回真实 prepared statement,用法与现状(users.js:216 `ins.xxx.run(...)`)一致
    prepare: (sql) => prep(sql),
    insertIgnore: async (sql, ...params) => {
      const r = raw.prepare(insertIgnoreSql(sql)).run(...fix(params))
      return { changes: r.changes ?? 0, lastInsertRowid: Number(r.lastInsertRowid), insertId: Number(r.lastInsertRowid) }
    },
  }
}

function buildMysqlDao() {
  const pool = mysql.createPool({
    ...mysqlConfig(),
    waitForConnections: true,
    queueLimit: 0,
    // 关键:关闭默认 Date 还原,改回字符串,避免 routes 的 `due_at + 'Z'` / `e.date === 'YYYY-MM-DD'` 比较炸掉
    dateStrings: true,
    // DDL exec 需要(其它路径全部参数化,无注入风险)
    multipleStatements: true,
    charset: 'utf8mb4_general_ci',
  })
  const norm = (rows) => Array.isArray(rows) ? normRows(rows) : (rows ? normRow(rows) : rows)
  return {
    driver: 'mysql',
    close: async () => { await pool.end() },
    exec: async (sql) => { await pool.query(sql) },
    run: async (sql, ...params) => {
      const [r] = await pool.execute(sql, fix(params))
      return { changes: r.affectedRows ?? 0, lastInsertRowid: Number(r.insertId), insertId: Number(r.insertId) }
    },
    get: async (sql, ...params) => {
      const [rows] = await pool.execute(sql, fix(params))
      return rows.length ? normRow(rows[0]) : undefined
    },
    all: async (sql, ...params) => {
      const [rows] = await pool.execute(sql, fix(params))
      return normRows(rows)
    },
    // mysql2 真 prepared statements 绑死在某连接上,跨多 connection 会卡;为避开该坑,prepare 返回闭包
    // 让路由调用形态保持 `ins.xxx.run(...)` 不变,但每次都重新执行(走 connection pool 自动负载均衡)
    prepare: (sql) => ({
      run: async (...params) => {
        const [r] = await pool.execute(sql, fix(params))
        return { changes: r.affectedRows ?? 0, lastInsertRowid: Number(r.insertId), insertId: Number(r.insertId) }
      },
      get: async (...params) => {
        const [rows] = await pool.execute(sql, fix(params))
        return rows.length ? normRow(rows[0]) : undefined
      },
      all: async (...params) => {
        const [rows] = await pool.execute(sql, fix(params))
        return normRows(rows)
      },
    }),
    insertIgnore: async (sql, ...params) => {
      const [r] = await pool.execute(insertIgnoreSql(sql), fix(params))
      return { changes: r.affectedRows ?? 0, lastInsertRowid: Number(r.insertId), insertId: Number(r.insertId) }
    },
  }
}

export const db = DRIVER === 'mysql' ? buildMysqlDao() : buildSqliteDao()

// ---- 两份 DDL:语法不同(标识符 / 默认值 / 引擎 / 索引位置),语义一致 ----
const DDL_SQLITE = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now')),
  goal TEXT, self_level TEXT, prefs TEXT
);
CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT UNIQUE NOT NULL,
  ipa TEXT NOT NULL, pos TEXT NOT NULL, meaning TEXT NOT NULL,
  root TEXT NOT NULL, root_meaning TEXT NOT NULL, etymology TEXT NOT NULL,
  collocations TEXT NOT NULL DEFAULT '[]', examples TEXT NOT NULL DEFAULT '[]',
  mnemonic TEXT,
  family TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_words_root ON words(root);
CREATE INDEX IF NOT EXISTS ix_words_family ON words(family);
CREATE TABLE IF NOT EXISTS phonemes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT UNIQUE NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL,
  voiced INTEGER NOT NULL DEFAULT 1, tip TEXT NOT NULL,
  similar TEXT NOT NULL DEFAULT '[]', example_words TEXT NOT NULL DEFAULT '[]',
  level INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS grammar_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT UNIQUE NOT NULL, category TEXT NOT NULL, formula TEXT NOT NULL,
  explanation TEXT NOT NULL,
  examples TEXT NOT NULL DEFAULT '[]', machine TEXT NOT NULL DEFAULT '{}', quiz TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS passages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL,
  sentences TEXT NOT NULL DEFAULT '[]', questions TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS user_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id), word_id INTEGER NOT NULL REFERENCES words(id),
  repetitions INTEGER NOT NULL DEFAULT 0, ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0,
  peak_strength REAL NOT NULL DEFAULT 0,
  stability REAL, difficulty REAL,
  first_learned_at TEXT, last_review_at TEXT, due_at TEXT,
  UNIQUE(user_id, word_id)
);
CREATE INDEX IF NOT EXISTS ix_user_words_user ON user_words(user_id);
CREATE TABLE IF NOT EXISTS grammar_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id), point_id INTEGER NOT NULL REFERENCES grammar_points(id),
  quiz_index INTEGER NOT NULL, correct INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS ix_grammar_results_user ON grammar_results(user_id);
CREATE TABLE IF NOT EXISTS listening_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id), passage_id INTEGER NOT NULL REFERENCES passages(id),
  correct_count INTEGER NOT NULL, total INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS ix_listening_results_user ON listening_results(user_id);
CREATE TABLE IF NOT EXISTS speaking_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id), passage_id INTEGER NOT NULL REFERENCES passages(id),
  sentence_index INTEGER NOT NULL, score REAL NOT NULL, transcript TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS ix_speaking_results_user ON speaking_results(user_id);
CREATE TABLE IF NOT EXISTS activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id), date TEXT NOT NULL,
  module TEXT NOT NULL, correct INTEGER NOT NULL, total INTEGER NOT NULL,
  word_id INTEGER REFERENCES words(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS ix_activity_user ON activity_events(user_id);
CREATE INDEX IF NOT EXISTS ix_activity_date ON activity_events(date);
CREATE INDEX IF NOT EXISTS ix_activity_module ON activity_events(module);
CREATE TABLE IF NOT EXISTS phonetic_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL, ref_id TEXT NOT NULL DEFAULT '',
  correct INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS ix_phonetic_results_user ON phonetic_results(user_id);
CREATE TABLE IF NOT EXISTS reading_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id), passage_id INTEGER NOT NULL REFERENCES passages(id),
  correct_count INTEGER NOT NULL, total INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS ix_reading_results_user ON reading_results(user_id);
CREATE TABLE IF NOT EXISTS writing_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  stage TEXT NOT NULL,
  word_id INTEGER REFERENCES words(id),
  score REAL NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  feedback TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS ix_writing_results_user ON writing_results(user_id);
CREATE TABLE IF NOT EXISTS diary_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  zh_text TEXT NOT NULL, en_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS ix_diary_user ON diary_entries(user_id, created_at);
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL DEFAULT 'accent',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now')),
  UNIQUE(user_id, name)
);
CREATE TABLE IF NOT EXISTS collection_words (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now')),
  PRIMARY KEY (collection_id, word_id)
);
CREATE INDEX IF NOT EXISTS ix_collection_words_word ON collection_words(word_id);
`

const DDL_MYSQL = `
CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(191) UNIQUE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  goal VARCHAR(64) NULL, self_level VARCHAR(64) NULL, prefs TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS words (
  id INT PRIMARY KEY AUTO_INCREMENT,
  word VARCHAR(191) UNIQUE NOT NULL,
  ipa VARCHAR(191) NOT NULL, pos VARCHAR(64) NOT NULL, meaning TEXT NOT NULL,
  root VARCHAR(64) NOT NULL, root_meaning VARCHAR(191) NOT NULL, etymology TEXT NOT NULL,
  collocations TEXT NOT NULL DEFAULT ('[]'), examples TEXT NOT NULL DEFAULT ('[]'), mnemonic TEXT,
  family VARCHAR(64) NOT NULL, level INT NOT NULL DEFAULT 1,
  KEY ix_words_root (root), KEY ix_words_family (family)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS phonemes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  symbol VARCHAR(32) UNIQUE NOT NULL, type VARCHAR(32) NOT NULL, name VARCHAR(191) NOT NULL,
  voiced TINYINT(1) NOT NULL DEFAULT 1, tip TEXT NOT NULL,
  similar TEXT NOT NULL DEFAULT ('[]'), example_words TEXT NOT NULL DEFAULT ('[]'),
  level INT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS grammar_points (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(255) UNIQUE NOT NULL, category VARCHAR(64) NOT NULL, formula VARCHAR(255) NOT NULL,
  explanation TEXT NOT NULL,
  examples TEXT NOT NULL DEFAULT ('[]'), machine TEXT NOT NULL DEFAULT ('{}'), quiz TEXT NOT NULL DEFAULT ('[]')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS passages (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL, level INT NOT NULL DEFAULT 1, type VARCHAR(32) NOT NULL,
  sentences TEXT NOT NULL DEFAULT ('[]'), questions TEXT NOT NULL DEFAULT ('[]')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS user_words (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL, word_id INT NOT NULL,
  repetitions INT NOT NULL DEFAULT 0, ease DOUBLE NOT NULL DEFAULT 2.5,
  interval_days DOUBLE NOT NULL DEFAULT 0, lapses INT NOT NULL DEFAULT 0,
  peak_strength DOUBLE NOT NULL DEFAULT 0,
  stability DOUBLE NULL, difficulty DOUBLE NULL,
  first_learned_at DATETIME NULL, last_review_at DATETIME NULL, due_at DATETIME NULL,
  UNIQUE KEY uq_user_word (user_id, word_id),
  KEY ix_user_words_user (user_id),
  CONSTRAINT fk_uw_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_uw_word FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS grammar_results (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL, point_id INT NOT NULL,
  quiz_index INT NOT NULL, correct TINYINT(1) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  KEY ix_grammar_results_user (user_id),
  CONSTRAINT fk_gr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_gr_point FOREIGN KEY (point_id) REFERENCES grammar_points(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS listening_results (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL, passage_id INT NOT NULL,
  correct_count INT NOT NULL, total INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  KEY ix_listening_results_user (user_id),
  CONSTRAINT fk_lr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_lr_passage FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS speaking_results (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL, passage_id INT NOT NULL,
  sentence_index INT NOT NULL, score DOUBLE NOT NULL, transcript TEXT NOT NULL DEFAULT (''),
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  KEY ix_speaking_results_user (user_id),
  CONSTRAINT fk_sr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sr_passage FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS activity_events (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL, date DATE NOT NULL,
  module VARCHAR(32) NOT NULL, correct TINYINT(1) NOT NULL, total INT NOT NULL,
  word_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  KEY ix_activity_user (user_id), KEY ix_activity_date (date), KEY ix_activity_module (module),
  CONSTRAINT fk_ae_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ae_word FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS phonetic_results (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  kind VARCHAR(64) NOT NULL, ref_id VARCHAR(191) NOT NULL DEFAULT (''),
  correct TINYINT(1) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  KEY ix_phonetic_results_user (user_id),
  CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS reading_results (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL, passage_id INT NOT NULL,
  correct_count INT NOT NULL, total INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  KEY ix_reading_results_user (user_id),
  CONSTRAINT fk_rr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rr_passage FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS writing_results (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL, stage VARCHAR(32) NOT NULL, word_id INT NULL,
  score DOUBLE NOT NULL,
  text TEXT NOT NULL,
  feedback TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  KEY ix_writing_results_user (user_id),
  CONSTRAINT fk_wr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_wr_word FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS collections (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  name VARCHAR(191) NOT NULL, color VARCHAR(64) NOT NULL DEFAULT 'accent',
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  UNIQUE KEY uq_user_name (user_id, name),
  CONSTRAINT fk_col_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS collection_words (
  collection_id INT NOT NULL,
  word_id INT NOT NULL,
  added_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  PRIMARY KEY (collection_id, word_id),
  KEY ix_cw_word (word_id),
  CONSTRAINT fk_cw_col FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  CONSTRAINT fk_cw_word FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS diary_entries (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  zh_text TEXT NOT NULL, en_text TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  KEY ix_diary_user (user_id, created_at),
  CONSTRAINT fk_diary_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
`

const load = (name) => {
  const p = path.join(DATA_DIR, name)
  if (!existsSync(p)) return []
  return JSON.parse(readFileSync(p, 'utf-8'))
}

// JSON 列读写助手(路由层经此导出使用)
export const J = {
  parse: (s) => (s == null ? [] : JSON.parse(s)),
  str: (v) => JSON.stringify(v ?? []),
}

// 从 data/*.json 播种知识库(幂等:按 unique 键跳过已存在记录;内容迭代时 UPDATE 既有行)
export async function seed() {
  const stats = { words: 0, phonemes: 0, grammar: 0, passages: 0 }

  const existingWords = new Map((await db.all('SELECT word, ipa, pos, meaning, root, root_meaning, etymology, collocations, examples, family, level FROM words')).map((r) => [r.word, r]))
  const insWord = db.prepare(
    `INSERT INTO words (word, ipa, pos, meaning, root, root_meaning, etymology, collocations, examples, mnemonic, family, level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  // 已存在但任一字段有变化(内容迭代:例句/搭配/记忆法/释义...) → 全量 UPDATE,保证增量内容刷新即生效
  const updWord = db.prepare(`UPDATE words SET ipa = ?, pos = ?, meaning = ?, root = ?, root_meaning = ?, etymology = ?, collocations = ?, examples = ?, mnemonic = ?, family = ?, level = ? WHERE word = ?`)
  // 40 词根词 + 五源全量词表扩展词(lexicon.json, family='general')
  const seedWords = load('words.json').concat(load('lexicon.json'))
  for (const it of seedWords) {
    const exist = existingWords.get(it.word)
    const exStr = J.str(it.examples || [])
    const coStr = J.str(it.collocations || [])
    if (exist) {
      if (exist.ipa !== it.ipa || exist.pos !== it.pos || exist.meaning !== it.meaning
        || exist.root !== it.root || exist.root_meaning !== it.root_meaning || exist.etymology !== it.etymology
        || exist.collocations !== coStr || exist.examples !== exStr
        || (exist.mnemonic ?? null) !== (it.mnemonic ?? null)
        || exist.family !== (it.family || it.root) || exist.level !== (it.level ?? 1)) {
        await updWord.run(it.ipa, it.pos, it.meaning, it.root, it.root_meaning, it.etymology,
          coStr, exStr, it.mnemonic ?? null, it.family || it.root, it.level ?? 1, it.word)
      }
      continue
    }
    await insWord.run(it.word, it.ipa, it.pos, it.meaning, it.root, it.root_meaning, it.etymology,
      coStr, exStr, it.mnemonic ?? null, it.family || it.root, it.level ?? 1)
    stats.words++
  }

  const existingPhonemes = new Set((await db.all('SELECT symbol FROM phonemes')).map((r) => r.symbol))
  const insPhoneme = db.prepare(
    `INSERT INTO phonemes (symbol, type, name, voiced, tip, similar, example_words, level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  for (const it of load('phonemes.json')) {
    if (existingPhonemes.has(it.symbol)) continue
    await insPhoneme.run(it.symbol, it.type, it.name, it.voiced ?? true, it.tip,
      J.str(it.similar || []), J.str(it.example_words || []), it.level ?? 1)
    stats.phonemes++
  }

  const existingGrammar = new Map((await db.all('SELECT id, title, quiz FROM grammar_points')).map((r) => [r.title, r]))
  const insGrammar = db.prepare(
    `INSERT INTO grammar_points (title, category, formula, explanation, examples, machine, quiz)
     VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const updGrammar = db.prepare('UPDATE grammar_points SET quiz = ? WHERE id = ?')
  for (const it of load('grammar.json')) {
    const exist = existingGrammar.get(it.title)
    if (exist) {
      // 已存在但题库有变化(内容迭代) → 更新 quiz
      if (JSON.stringify(exist.quiz) !== JSON.stringify(it.quiz || [])) await updGrammar.run(J.str(it.quiz || []), exist.id)
      continue
    }
    await insGrammar.run(it.title, it.category, it.formula, it.explanation,
      J.str(it.examples || []), JSON.stringify(it.machine || { parts: [] }), J.str(it.quiz || []))
    stats.grammar++
  }

  const existingPassages = new Map((await db.all('SELECT type, title, sentences, questions FROM passages')).map((r) => [`${r.type}|${r.title}`, r]))
  const insPassage = db.prepare(
    `INSERT INTO passages (title, level, type, sentences, questions) VALUES (?, ?, ?, ?, ?)`)
  // 已存在但句库/题库有变化(内容迭代) → UPDATE
  const updPassage = db.prepare('UPDATE passages SET sentences = ?, questions = ? WHERE type = ? AND title = ?')
  for (const it of load('passages.json')) {
    const key = `${it.type}|${it.title}`
    const exist = existingPassages.get(key)
    const seStr = J.str(it.sentences || [])
    const qStr = J.str(it.questions || [])
    if (exist) {
      if (exist.sentences !== seStr || exist.questions !== qStr) {
        await updPassage.run(seStr, qStr, it.type, it.title)
      }
      continue
    }
    await insPassage.run(it.title, it.level ?? 1, it.type, seStr, qStr)
    stats.passages++
  }

  return stats
}

export async function initDb() {
  await db.exec(DRIVER === 'mysql' ? DDL_MYSQL : DDL_SQLITE)
  // 兼容迁移:老 wordpeak.db 的 users 表没有档案列(CREATE IF NOT EXISTS 不会补)。
  // ALTER TABLE 逐列补齐,列已存在时 SQLite/MySQL 报错 → 吞掉,幂等且不丢已有数据。
  for (const col of ['goal', 'self_level', 'prefs']) {
    try { await db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`) } catch { /* 列已存在,跳过 */ }
  }
  // words.mnemonic(记忆法通道,内容补齐轮引入;老库补列)
  try { await db.exec('ALTER TABLE words ADD COLUMN mnemonic TEXT') } catch { /* 列已存在,跳过 */ }
  // user_words.stability / difficulty(FSRS 迁移;老 SM-2 库补列)
  const fsrsType = DRIVER === 'mysql' ? 'DOUBLE NULL' : 'REAL'
  for (const col of ['stability', 'difficulty']) {
    try { await db.exec(`ALTER TABLE user_words ADD COLUMN ${col} ${fsrsType}`) } catch { /* 列已存在,跳过 */ }
  }

  const seeded = await seed()

  // FSRS 一次性回填(幂等):老 SM-2 行按旧字段推 stability/difficulty 初值。
  // 只写新列,不动 due_at/peak_strength/repetitions —— 旧列保留做兼容与回滚。
  const legacy = await db.all('SELECT id, ease, interval_days, lapses, repetitions FROM user_words WHERE stability IS NULL')
  if (legacy.length) {
    const upd = db.prepare('UPDATE user_words SET stability = ?, difficulty = ? WHERE id = ?')
    for (const r of legacy) {
      const f = migrateSm2ToFsrs({ ease: r.ease, intervalDays: r.interval_days, lapses: r.lapses, repetitions: r.repetitions })
      await upd.run(f.stability, f.difficulty, r.id)
    }
  }
  return seeded
}

export { DRIVER }