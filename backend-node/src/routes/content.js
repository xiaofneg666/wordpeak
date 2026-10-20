// 静态内容:技巧库 / 书单 / 四步路线 —— 直接从 data/*.json 提供,源文件即内容库
import { Router } from 'express'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../db.js'
import { ok } from '../helpers.js'

export const contentRouter = Router()

// dev 每次读文件:内容迭代后刷新即生效,无需重启
const load = (file) => JSON.parse(readFileSync(path.join(DATA_DIR, file), 'utf-8'))

contentRouter.get('/tips', (_req, res) => res.json(ok(load('tips.json'))))
contentRouter.get('/books', (_req, res) => res.json(ok(load('books.json'))))
contentRouter.get('/roadmap', (_req, res) => res.json(ok(load('roadmap.json'))))
