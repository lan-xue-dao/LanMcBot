import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dataDir } from './paths.mjs'

// 资源目录：node 直跑 = lib/（import.meta.url 可用）；esbuild bundle/pkg 下 import.meta.url 为空，
// 资源随 pkg assets 收进快照（/snapshot/...）或落在 exe 旁的 data/——两种都尝试，i18n 表缺失时降级英文原名。
const resourceDirs = (() => {
  const dirs = []
  try {
    const u = fileURLToPath(import.meta.url)
    if (typeof u === 'string' && u) dirs.push(path.dirname(u))
  } catch { /* bundle 形态：无 import.meta.url */ }
  dirs.push(path.join(dataDir(), 'lib'), dataDir())
  return dirs
})();

let lang = {}
// 反向索引：normalizeName(value) → [{key, value}, ...]
// 用于 O(1) 中文/别名 → ID 查找，避免每次 translateWithPrefix 都遍历全表
let reverseIndex = new Map()

try {
  for (const dir of resourceDirs) {
    const file = path.join(dir, 'data', 'zh_cn.json')
    if (!fs.existsSync(file)) continue
    lang = JSON.parse(fs.readFileSync(file, 'utf8'))
    buildReverseIndex()
    break
  }
} catch {}

function buildReverseIndex() {
  reverseIndex = new Map()
  for (const [key, value] of Object.entries(lang)) {
    const normValue = normalizeName(value)
    if (!reverseIndex.has(normValue)) reverseIndex.set(normValue, [])
    reverseIndex.get(normValue).push({ key, value })
  }
}

function lookup(key) {
  return lang[key]
}

function normalizeName(s) {
  return String(s).toLowerCase().replace(/[-_\s]+/g, '')
}

function translateWithPrefix(name, prefix) {
  if (!name) return name
  const localized = lookup(`${prefix}.minecraft.${name}`)
  if (localized) return localized
  const norm = normalizeName(name)
  // 优先反向索引 O(1)
  const matches = reverseIndex.get(norm)
  if (matches) {
    for (const { key, value } of matches) {
      if (key.startsWith(`${prefix}.minecraft.`)) return value
    }
  }
  // 兜底：遍历（处理反向索引未覆盖的边界情况）
  for (const [key, value] of Object.entries(lang)) {
    if (!key.startsWith(`${prefix}.minecraft.`)) continue
    const id = key.slice(prefix.length + 11)
    if (normalizeName(id) === norm || normalizeName(value) === norm) return value
  }
  return name
}

export function translateEntity(name) {
  return translateWithPrefix(name, 'entity')
}

export function translateBlock(name) {
  const blockResult = translateWithPrefix(name, 'block')
  if (blockResult !== name) return blockResult
  return translateWithPrefix(name, 'item')
}

export function blockIdFromZh(zh) {
  if (!zh) return null
  // 优先反向索引
  const norm = normalizeName(zh)
  const matches = reverseIndex.get(norm)
  if (matches) {
    for (const { key, value } of matches) {
      const m = key.match(/^(?:block|item)\.minecraft\.(.+)$/)
      if (m) return m[1]
    }
  }
  // 兜底
  for (const [key, value] of Object.entries(lang)) {
    if (value !== zh) continue
    const match = key.match(/^(?:block|item)\.minecraft\.(.+)$/)
    if (match) return match[1]
  }
  return null
}

export function translateMessage(rawMsg) {
  let msg = rawMsg

  msg = msg.replace(/(\S+) joined the game/g, '$1 加入了游戏')
  msg = msg.replace(/(\S+) left the game/g, '$1 离开了游戏')
  msg = msg.replace(/There are (\d+) of a max of (\d+) players online: (.+)/, '在线玩家 $1/$2: $3')
  msg = msg.replace(/You are currently connected to (\S+)\./, '当前服务器: $1')
  msg = msg.replace(/Available servers: (.+)/, '可用服务器: $1')
  msg = msg.replace(/You were kicked from/gi, '你被移出')
  msg = msg.replace(/You are now playing on/gi, '当前游玩于')

  return msg
}
