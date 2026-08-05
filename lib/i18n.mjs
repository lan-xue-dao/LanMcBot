import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let lang = {}
try {
  lang = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'zh_cn.json'), 'utf8'))
} catch {}

function lookup(key) {
  return lang[key]
}

export function translateEntity(name) {
  return lookup(`entity.minecraft.${name}`) || name
}

export function translateBlock(name) {
  const localized = lookup(`block.minecraft.${name}`) || lookup(`item.minecraft.${name}`)
  return localized || name
}

export function blockIdFromZh(zh) {
  if (!zh) return null
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