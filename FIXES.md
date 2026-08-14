# 代码修复计划

本文档提供具体代码修复方案，按优先级排序。

---

## 1. 高优先级修复 🔴

### 1.1 密码明文存储 → 使用环境变量

**文件**: `lib/config.mjs`

**当前代码**:
```javascript
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const config = require('../config.json')

export default config
```

**修复后**:
```javascript
import * as crypto from 'crypto'
import * as path from 'path'

const passwordFile = path.join(process.cwd(), 'password.enc')
const keyEnvVar = 'MCBOT_PASSWORD_KEY'

function getDecryptedPassword() {
  // 优先使用环境变量（最安全）
  if (process.env[keyEnvVar]) {
    return process.env[keyEnvVar]
  }

  // 从加密文件读取
  try {
    const encrypted = Buffer.from(passwordFile, 'utf8')
    const key = crypto.createHash('sha256').update(process.env[keyEnvVar]).digest()

    // 使用前 16 字节作为 IV（初始化向量）
    const iv = key.slice(0, 16)
    const cipherKey = key.slice(16)

    const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv)
    let decrypted = decipher.update(encrypted)
    decrypted = Buffer.concat([decrypted, decipher.final()])
    return decrypted.toString('utf8')
  } catch (err) {
    console.warn('无法读取密码，请设置环境变量或初始化加密文件')
    return ''
  }
}

export default {
  host: process.env.MCBOT_HOST || 'play.simpfun.cn',
  port: parseInt(process.env.MCBOT_PORT) || 40299,
  username: process.env.MCBOT_USERNAME || 'LanBot',
  auth: process.env.MCBOT_AUTH || 'offline',
  password: process.env.MCBOT_PASSWORD || getDecryptedPassword(),
  ui: process.env.MCBOT_UI || 'cli'
}
```

**配置步骤**:
```bash
# 1. 生成加密密钥
node -e "console.log(require('crypto').createHash('sha256').update('your-secret-key').digest('hex'))"

# 2. 加密密码
ENCRYPTION_KEY="your-32-byte-hex-key"  # 从上一步获得
echo "Lanbot" | openssl enc -aes-256-cbc -salt -pbkdf2 -in /dev/stdin -out password.enc -K $ENCRYPTION_KEY

# 3. 设置环境变量（更安全）
export MCBOT_PASSWORD_KEY="your-secret-key"
export MCBOT_PASSWORD="Lanbot"

# 4. 运行
npm start
```

---

### 1.2 MCP 服务器状态管理

**文件**: `mcp-server.mjs`

**当前代码**:
```javascript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'send_chat': {
        const b = createBot()  // 每次都创建新 bot
        if (!b) return { content: [{ type: 'text', text: '无法创建机器人' }] }
        b.chat(args.message)
        return { content: [{ type: 'text', text: `已发送: ${args.message}` }] }
      }
      // ...
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `错误: ${err.message}` }], isError: true }
  }
})
```

**修复后**:
```javascript
import { createBot, getBot, destroyBot } from './lib/bot.mjs'

let globalBot = null
let globalNav = null
let mcpStarted = false
const mcpShutdown = async () => {
  if (mcpStarted && globalBot) {
    if (globalNav) {
      globalNav.destroy()
      globalNav = null
    }
    if (globalBot) {
      globalBot = null
    }
    mcpStarted = false
  }
}

// 优雅关闭
process.on('SIGINT', mcpShutdown)
process.on('SIGTERM', mcpShutdown)

function ensureBot() {
  if (!globalBot) {
    globalBot = createBot((event, data) => {
      console.error(`[MCP] Event:`, event, data)
    })
    globalNav = null  // nav 在 createBot 时初始化，这里需要重新获取
  }
  return globalBot
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'send_chat',
      description: '发送聊天消息到Minecraft服务器',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string', description: '要发送的消息' } },
        required: ['message']
      }
    },
    {
      name: 'get_status',
      description: '获取机器人状态',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'get_players',
      description: '获取在线玩家列表',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'get_position',
      description: '获取机器人位置',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'get_inventory',
      description: '获取机器人背包物品',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'connect',
      description: '连接到Minecraft服务器',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'disconnect',
      description: '断开与Minecraft服务器的连接',
      inputSchema: { type: 'object', properties: {} }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'send_chat': {
        const b = ensureBot()
        if (!b) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        b.chat(args.message)
        return { content: [{ type: 'text', text: `已发送: ${args.message}` }] }
      }

      case 'get_status': {
        const b = getBot()
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              connected: !!b,
              username: b?.username || null,
              health: b?.health || null,
              food: b?.food || null,
              position: b?.entity?.position
                ? { x: b.entity.position.x.toFixed(1), y: b.entity.position.y.toFixed(1), z: b.entity.position.z.toFixed(1) }
                : null
            }, null, 2)
          }]
        }
      }

      case 'get_players': {
        const b = getBot()
        if (!b?.players) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const players = Object.values(b.players).map(p => ({
          name: p.username,
          ping: p.ping
        }))
        return { content: [{ type: 'text', text: JSON.stringify(players, null, 2) }] }
      }

      case 'get_position': {
        const b = getBot()
        if (!b?.entity?.position) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const pos = b.entity.position
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ x: pos.x.toFixed(1), y: pos.y.toFixed(1), z: pos.z.toFixed(1) })
          }]
        }
      }

      case 'get_inventory': {
        const b = getBot()
        if (!b?.inventory) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const items = b.inventory.items().map(i => ({
          name: i.name,
          count: i.count,
          slot: i.slot
        }))
        return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] }
      }

      case 'connect': {
        const b = ensureBot()
        if (b) {
          return { content: [{ type: 'text', text: '机器人已连接' }] }
        } else {
          return { content: [{ type: 'text', text: '正在连接...' }], isError: true }
        }
      }

      case 'disconnect': {
        if (globalBot) {
          destroyBot()
        }
        return { content: [{ type: 'text', text: '已断开' }] }
      }

      default:
        return { content: [{ type: 'text', text: `未知工具: ${name}` }], isError: true }
    }
  } catch (err) {
    console.error('MCP tool error:', err)
    return { content: [{ type: 'text', text: `错误: ${err.message}` }], isError: true }
  }
})

async function main() {
  mcpStarted = true
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('MCP Server running on stdio')
}

main().catch(err => {
  console.error('Failed to start MCP server:', err)
  process.exit(1)
})
```

---

### 1.3 添加 TypeScript 类型定义

**文件**: `index.d.ts`

**创建新文件**:
```typescript
// index.d.ts
declare module 'mineflayer' {
  export interface Bot {
    username: string
    health: number
    food: number
    isSleeping: boolean
    entities: Record<string, Entity>
    players: Record<string, Player>
    inventory: {
      items(): InventoryItem[]
      items(slot?: number): InventoryItem | undefined
    }
    position: Vec3
    yaw: number
    pitch: number
    blockAt(pos: vec3, ignoreLoaded?: boolean): Block | null
    chat(message: string): void
    sleep(block: Block, callback?: (err?: Error) => void): void
    wake(): void
    activateItem(): void
    activateBlock(block: Block): void
    placeBlock(reference: Block, face: vec3, callback?: (err?: Error) => void): void
    attack(target: Entity): void
    useOn(target: Entity): void
    setControlState(control: string, state: boolean): void
    look(yaw: number, pitch: number, force?: boolean): void
    setControl(control: string, state: boolean): void
    clearControlState(control: string): void
    clearControls(): void
    findBlock(options: {
      matching?: (block: Block) => boolean
      maxDistance?: number
      count?: number
    }): Block | null
    findBlocks(options: {
      matching?: (block: Block) => boolean
      maxDistance?: number
      count?: number
    }): vec3[]
  }

  export interface Entity {
    id: number
    name: string
    username?: string
    type: string
    position: vec3
    velocity?: vec3
    yaw?: number
    pitch?: number
  }

  export interface Player {
    username: string
    ping: number
    entity?: Entity
  }

  export interface Vec3 {
    x: number
    y: number
    z: number
    offset(x: number, y: number, z: number): Vec3
    distanceTo(other: Vec3): number
    floored(): Vec3
    plus(other: Vec3): Vec3
    clone(): Vec3
  }

  export interface Block {
    name: string
    position: Vec3
    type: number
    metadata: number
    _properties?: Record<string, any>
    shapes?: number[][]
    boundingBox?: string
    count?: number
  }

  export interface InventoryItem {
    name: string
    displayName?: string
    count: number
    type: number
    slot: number
    nbt?: any
  }

  export function createBot(options: {
    host?: string
    port?: number
    username?: string
    auth?: 'offline' | 'microsoft' | 'xbox'
    password?: string
    verbose?: boolean
  }): Bot
}

export { createBot, getBot, destroyBot, isLoggedIn, isReconnecting } from './lib/bot.mjs'
export { initNav, goto, stop, isMoving, destroy } from './lib/nav/index.mjs'
export { scanEntities, scanPlayers, scanBlocks, findBlock, getDangerLevel } from './lib/perception/index.mjs'
export { startPassivePerception, stopPassivePerception, getStatus } from './lib/perception/index.mjs'
export { translateEntity, translateBlock, translateMessage, blockIdFromZh } from './lib/i18n.mjs'
export { log, chatLog, logRaw } from './lib/logger.mjs'
export { handleCommand } from './lib/commands.mjs'

// 导出类型
export type Bot = import('mineflayer').Bot
export type Entity = import('mineflayer').Entity
export type Player = import('mineflayer').Player
export type Vec3 = import('vec3').Vec3
export type Block = import('mineflayer').Block
export type InventoryItem = import('mineflayer').InventoryItem
```

**更新 package.json**:
```json
{
  "name": "mcbot",
  "version": "1.1.0",
  "description": "Minecraft mineflayer bot with 3D control panel, HTTP API and MCP server",
  "license": "ISC",
  "type": "commonjs",
  "main": "index.js",
  "types": "index.d.ts",
  "scripts": {
    "start": "node index.js",
    "mcp": "node mcp-server.mjs",
    "mcp:sse": "node mcp-server.mjs --transport=sse",
    "mcp:stdio": "node mcp-server.mjs --transport=stdio",
    "verify": "node --check index.js && node --check lib/**/*.mjs",
    "lint": "eslint . --ext .mjs"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "mineflayer": "^4.37.1",
    "mineflayer-pathfinder": "^2.4.5",
    "ws": "^8.21.2"
  }
}
```

---

## 2. 中优先级修复 🟡

### 2.1 重启逻辑优化

**文件**: `lib/commands.mjs`

**修复后**:
```javascript
if (cmd === '！restart' || cmd === '!restart') {
  bot.destroyBot()
  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: 'inherit',
    windowsHide: true  // Windows 上隐藏控制台窗口
  })

  let spawnSuccess = false
  child.once('spawn', () => {
    spawnSuccess = true
    child.unref()
    addMessage(logRaw('正在重启...'))
    // 增加延迟确保子进程完全启动
    setTimeout(() => {
      addMessage(logRaw('子进程已启动，等待初始化完成'))
      exit()
    }, 1000)
  })

  child.once('error', (e) => {
    if (!spawnSuccess) {
      addMessage(logRaw(`重启失败: ${e.message}`))
      exit()
    }
  })

  // 超时保护
  setTimeout(() => {
    if (!spawnSuccess) {
      addMessage(logRaw('重启超时，正在退出'))
      exit()
    }
  }, 5000)

  return true
}
```

---

### 2.2 错误处理改进

**文件**: `lib/bot.mjs`

**修复 quitBot**:
```javascript
export function quitBot() {
  if (!bot) return

  // 确保导航停止
  if (nav) {
    try {
      nav.destroy()
    } catch (err) {
      console.error('Failed to destroy nav:', err)
    }
    nav = null
  }

  // 断开连接
  try {
    if (typeof bot.quit === 'function') {
      bot.quit()
    } else if (typeof bot.end === 'function') {
      bot.end()
    } else if (bot._client && typeof bot._client.end === 'function') {
      bot._client.end()
    }

    // 等待连接关闭
    return new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (!bot || !bot._client) {
          clearInterval(checkInterval)
          resolve()
        }
      }, 100)
    })
  } catch (err) {
    console.error('quitBot error:', err)
    // 即使出错也继续清理
  }

  // 清理引用
  bot = null
  loggedIn = false
}
```

**修复 sleep**:
```javascript
export function sleep() {
  if (!bot) return false
  if (bot.isSleeping) return 'already_sleeping'

  const bed = bot.findBlock({
    matching: (b) => b.name.endsWith('bed') || b.name === 'bed',
    maxDistance: 8
  })

  if (!bed) return 'no_bed'

  if (nav) nav.stop()

  // 返回 Promise
  return new Promise((resolve, reject) => {
    bot.sleep(bed, (err) => {
      if (err) {
        if (onMessageCallback) {
          onMessageCallback('sleep_failed', { err: err.message })
        }
        reject(new Error(err.message))
      } else {
        if (onMessageCallback) {
          onMessageCallback('sleep_started')
        }
        resolve('sleeping')
      }
    })
  })
}
```

---

### 2.3 资源缓存管理

**文件**: `lib/nav/world.mjs`

**修复 createWorld**:
```javascript
export function createWorld(blockAtFn, minY = -64, worldSize = 96) {
  const pos = { x: 0, y: 0, z: 0 }
  const cache = new Map()
  const cleanupInterval = 60000  // 1 分钟清理一次
  let cleanupTimer = null

  // 清理超出范围的缓存
  function cleanupCache() {
    for (const key of cache.keys()) {
      const [cx, cy, cz] = key.split(',').map(Number)
      const dist = Math.hypot(cx, cz)
      if (dist > worldSize / 2) {
        cache.delete(key)
      }
    }
  }

  // 启动清理定时器
  if (!cleanupTimer) {
    cleanupTimer = setInterval(cleanupCache, cleanupInterval)
  }

  function getCellP(x, y, z) {
    const key = `${x},${y},${z}`
    let info = cache.get(key)
    if (info === undefined) {
      pos.x = x; pos.y = y; pos.z = z
      const block = blockAtFn(pos)
      info = block ? blockInfo(block) : {
        name: '', liquid: false, climbable: false, openable: false, penetrable: false,
        open: false, avoid: false, iron: false, standable: false,
        bodyClear: true, needsOpen: false, top: 0, hasShapes: false
      }
      cache.set(key, info)
    }
    return info
  }

  const world = {
    minY,
    getCell: getCellP,
    clearCache() {
      cache.clear()
      if (cleanupTimer) {
        clearInterval(cleanupTimer)
        cleanupTimer = null
      }
    },
    getCacheSize() {
      return cache.size
    }
  }

  return world
}
```

---

### 2.4 异步操作返回 Promise

**文件**: `lib/commands.mjs`

**修复 placeBlock**:
```javascript
export function placeBlock(blockName, x, y, z, standX, standY, standZ) {
  if (!bot) return Promise.reject({ ok: false, reason: '未连接' })

  const target = vec3(Math.floor(x), Math.floor(y), Math.floor(z))
  const existing = bot.blockAt(target)
  if (existing && existing.name !== 'air' && existing.name !== 'water' && existing.name !== 'lava') {
    return Promise.reject({ ok: false, reason: `目标位置已有方块: ${existing.name}` })
  }

  const items = bot.inventory.items()
  const zhId = blockIdFromZh(blockName)
  let item = items.find(i =>
    i.name === blockName || i.name === `minecraft:${blockName}` ||
    (zhId && (i.name === zhId || i.name === `minecraft:${zhId}`))
  )
  if (!item) return Promise.reject({ ok: false, reason: `背包里没有方块: ${blockName}` })

  // 包装为 Promise
  return new Promise((resolve, reject) => {
    const doPlace = () => {
      let reference = null
      let face = null
      for (const f of FACES) {
        const neighbor = bot.blockAt(target.plus(vec3(...f.offset)))
        if (neighbor && neighbor.name !== 'air' && neighbor.name !== 'water' && neighbor.name !== 'lava') {
          reference = neighbor
          face = vec3(...f.vector)
          break
        }
      }
      if (!reference) {
        if (onMessageCallback) {
          onMessageCallback('place_failed', { err: '目标位置周围没有可放置的支撑面' })
        }
        reject({ ok: false, reason: '目标位置周围没有可放置的支撑面' })
        return
      }

      bot.equip(item, 'hand', (err) => {
        if (err) {
          if (onMessageCallback) {
            onMessageCallback('place_failed', { err: err.message || '装备物品失败' })
          }
          reject({ ok: false, reason: err.message || '装备物品失败' })
          return
        }
        bot.placeBlock(reference, face, (placeErr) => {
          if (placeErr) {
            if (onMessageCallback) {
              onMessageCallback('place_failed', { err: placeErr.message })
            }
            reject({ ok: false, reason: placeErr.message })
          } else {
            if (onMessageCallback) {
              onMessageCallback('block_placed', { name: blockName, x: target.x, y: target.y, z: target.z })
            }
            resolve({ ok: true, name: blockName })
          }
        })
      })
    }

    if (standX != null && standY != null && standZ != null) {
      const stand = vec3(Math.floor(standX), Math.floor(standY), Math.floor(standZ))
      if (stand.distanceTo(bot.entity.position) > 2) {
        if (nav) nav.stop()
        if (nav) nav.goto(stand.x, stand.y, stand.z)
        const checkInterval = setInterval(() => {
          if (!bot || !bot.entity) {
            clearInterval(checkInterval)
            reject({ ok: false, reason: '未连接' })
            return
          }
          if (bot.entity.position.distanceTo(stand) <= 2.5) {
            clearInterval(checkInterval)
            if (nav) nav.stop()
            setTimeout(() => doPlace(), 300)
          }
        }, 500)
        return
      }
    }

    doPlace()
  })
}
```

---

## 3. 低优先级修复 🟢

### 3.1 添加 .gitignore

**修复**: 替换 `K:\mcbot\.gitignore`:

```
# Dependencies
node_modules/

# Logs
*.log
bot_*.log
chat_*.log

# Configuration
config.json
password.enc
*.local.json

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Build
dist/
*.tsbuildinfo

# Test coverage
coverage/

# Environment
.env
.env.local
```

---

### 3.2 添加环境变量配置示例

**文件**: `lib/config.mjs` - 添加加载 `.env` 文件功能

```javascript
import * as dotenv from 'dotenv'  // 需要安装 dotenv 包
import * as crypto from 'crypto'
import * as path from 'path'

// 加载 .env 文件（如果存在）
dotenv.config()

const passwordFile = path.join(process.cwd(), 'password.enc')
const keyEnvVar = 'MCBOT_PASSWORD_KEY'

function getDecryptedPassword() {
  // 优先使用环境变量（最安全）
  if (process.env[keyEnvVar]) {
    return process.env[keyEnvVar]
  }

  // 从加密文件读取
  try {
    const encrypted = Buffer.from(passwordFile, 'utf8')
    const key = crypto.createHash('sha256').update(process.env[keyEnvVar]).digest()

    // 使用前 16 字节作为 IV（初始化向量）
    const iv = key.slice(0, 16)
    const cipherKey = key.slice(16)

    const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv)
    let decrypted = decipher.update(encrypted)
    decrypted = Buffer.concat([decrypted, decipher.final()])
    return decrypted.toString('utf8')
  } catch (err) {
    console.warn('无法读取密码，请设置环境变量或初始化加密文件')
    return ''
  }
}

export default {
  host: process.env.MCBOT_HOST || 'play.simpfun.cn',
  port: parseInt(process.env.MCBOT_PORT) || 40299,
  username: process.env.MCBOT_USERNAME || 'LanBot',
  auth: process.env.MCBOT_AUTH || 'offline',
  password: process.env.MCBOT_PASSWORD || getDecryptedPassword(),
  ui: process.env.MCBOT_UI || 'cli'
}
```

**创建 `.env.example`**:
```bash
# 服务器配置
MCBOT_HOST=play.simpfun.cn
MCBOT_PORT=40299
MCBOT_USERNAME=LanBot

# 认证
MCBOT_AUTH=offline
MCBOT_PASSWORD=Lanbot

# 安全密钥（用于加密配置）
MCBOT_PASSWORD_KEY=your-32-byte-hex-key-here

# UI 模式（cli | tui）
MCBOT_UI=cli
```

---

### 3.3 添加测试脚本

**创建 `tests/test-nav.mjs`**:
```javascript
import { expect } from 'chai'
import { createWorld } from '../lib/nav/world.mjs'
import { groundAt, bodyClearAt, blockInfo } from '../lib/nav/world.mjs'

describe('nav/world.mjs', () => {
  describe('blockInfo', () => {
    it('should identify lava as liquid', () => {
      const block = { name: 'lava', _properties: {} }
      const info = blockInfo(block)
      expect(info.liquid).to.be.true
    })

    it('should identify fence as fence', () => {
      const block = { name: 'oak_fence', _properties: {} }
      const info = blockInfo(block)
      expect(info.fence).to.be.true
    })

    it('should identify wood door as openable', () => {
      const block = { name: 'oak_door', _properties: { open: false } }
      const info = blockInfo(block)
      expect(info.openable).to.be.true
      expect(info.needsOpen).to.be.true
    })

    it('should identify iron door as openable but needs no opening', () => {
      const block = { name: 'iron_door', _properties: { open: false } }
      const info = blockInfo(block)
      expect(info.openable).to.be.true
      expect(info.needsOpen).to.be.false
      expect(info.iron).to.be.true
    })
  })

  describe('groundAt', () => {
    it('should find ground surface', () => {
      const world = createWorld((pos) => {
        if (pos.x === 0 && pos.y === 1 && pos.z === 0) {
          return { name: 'stone', _properties: {} }
        }
        return null
      })

      const ground = groundAt(world, 0, 0, 10, -64)
      expect(ground).to.exist
      expect(ground.feetY).to.equal(2)  // stone 在 y=1，feetY 是 y+1
    })
  })

  describe('bodyClearAt', () => {
    it('should allow moving through air', () => {
      const world = createWorld((pos) => null)
      const result = bodyClearAt(world, 0, 0, 0, false)
      expect(result).to.be.true
    })

    it('should deny moving through lava', () => {
      const world = createWorld((pos) => {
        if (pos.y === 0) return { name: 'lava', _properties: {} }
        return null
      })
      const result = bodyClearAt(world, 0, 0, 0, false)
      expect(result).to.be.false
    })
  })
})
```

**更新 package.json**:
```json
{
  "scripts": {
    "test": "mocha tests/**/*.mjs",
    "test:watch": "mocha tests/**/*.mjs --watch",
    "test:coverage": "nyc npm test"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "chai": "^4.3.0",
    "mocha": "^10.2.0",
    "nyc": "^15.1.0",
    "dotenv": "^16.0.0",
    "eslint": "^8.0.0"
  }
}
```

---

## 4. 修复验证清单

### 高优先级
- [ ] **密码安全**：创建加密密码文件，测试环境变量
- [ ] **MCP 服务器**：测试单实例、并发调用、重启
- [ ] **类型定义**：验证 TypeScript 语法检查通过

### 中优先级
- [ ] **重启逻辑**：测试重启是否成功，子进程是否稳定
- [ ] **错误处理**：测试各种错误场景（连接断开、操作失败等）
- [ ] **资源管理**：运行长时间后检查内存占用

### 低优先级
- [ ] **.gitignore**：验证未被忽略的文件
- [ ] **测试套件**：运行测试并查看覆盖率
- [ ] **文档**：更新 README

---

## 5. 实施建议

### 阶段 1：紧急修复（1-2 天）
1. 修复密码存储问题
2. 修复 MCP 服务器状态管理
3. 添加 TypeScript 类型定义

### 阶段 2：稳定性改进（3-5 天）
1. 优化重启逻辑
2. 完善错误处理
3. 修复资源缓存管理

### 阶段 3：代码质量（1-2 周）
1. 添加测试套件
2. 优化异步操作
3. 完善文档

### 阶段 4：持续改进（长期）
1. 添加 CI/CD
2. 性能监控
3. 代码审查流程

---

## 6. 风险评估

| 修复项 | 风险等级 | 潜在影响 | 缓解措施 |
|--------|---------|---------|---------|
| 密码加密 | 低 | 用户需要初始化加密文件 | 提供详细文档和脚本 |
| MCP 服务器 | 中 | 可能影响现有集成 | 保留旧代码路径兼容 |
| TypeScript | 中 | 可能破坏现有调用 | 添加 polyfill / 逐步迁移 |
| 测试套件 | 低 | 需要维护测试 | 先覆盖核心路径 |
| 资源缓存 | 低 | 稍微增加内存占用 | 配置合理的清理阈值 |
