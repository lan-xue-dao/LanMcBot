# mcbot 代码审查报告

**审查日期**: 2025-06-18
**项目版本**: 1.1.0
**审查范围**: 源码根目录 + lib/ + tui.mjs + cli.mjs + mcp-server.mjs

---

## 1. 总体评估

### 优点 ✅

1. **架构清晰**：模块化设计，职责分离良好
   - `lib/bot.mjs`：核心机器人控制
   - `lib/nav/`：自研导航引擎（DDA + A*）
   - `lib/perception/`：感知模块分离
   - `tui.mjs`/`cli.mjs`：双 UI 层

2. **自研导航引擎**：
   - 先规划（planRoute）后执行（controller）模式
   - DDA 直线检测 + A* 绕障
   - 门交互、地面扫描、障碍检测完善

3. **事件驱动设计**：
   - bot 事件统一通过 `onMessageCallback` 传播
   - UI 层监听统一事件源

4. **日志分离**：
   - `chat_YYYY-MM-DD.log`：聊天记录
   - `bot_YYYY-MM-DD.log`：运行日志

5. **MCP 集成**：
   - 支持 stdio 和 SSE 传输
   - 提供工具级 API

### 严重问题 ⚠️

#### 1.1 密码明文存储

**位置**: `config.json` 和 `lib/bot.mjs:219`

**问题**:
```json
{
  "password": "Lanbot"
}
```
```javascript
sendChat('/register ' + config.password + ' ' + config.password)
```

**影响**: 如果代码仓库被分享，密码会泄露。密码硬编码在客户端，无法防止服务器端破解。

**建议**:
- 使用环境变量：`password: process.env.MCBOT_PASSWORD`
- 或使用加密配置文件（Node.js `crypto` 模块）

**示例修复**:
```javascript
// config.mjs
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

const passwordFile = path.join(__dirname, 'password.enc')

function getDecryptedPassword() {
  const encrypted = fs.readFileSync(passwordFile, 'utf8')
  const key = crypto.createHash('sha256').update(process.env.MCBOT_PASSWORD_KEY).digest()
  const decipher = crypto.createDecipher('aes-256-cbc', key)
  return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8')
}

export default {
  password: process.env.MCBOT_PASSWORD || getDecryptedPassword(),
  // ...
}
```

---

#### 1.2 MCP 服务器状态管理混乱

**位置**: `mcp-server.mjs:58-134`

**问题**:
```javascript
case 'send_chat': {
  const b = createBot()  // 每次调用都创建新 bot，完全不一致
  if (!b) return { content: [{ type: 'text', text: '无法创建机器人' }] }
  b.chat(args.message)
  return { content: [{ type: 'text', text: `已发送: ${args.message}` }] }
}
```

- 每次工具调用都创建新的 bot 实例
- 严重资源浪费
- 并发调用会导致多个实例竞争
- 状态无法共享（背包、位置等）

**建议**:
```javascript
let globalBot = null

function ensureBot() {
  if (!globalBot) {
    globalBot = createBot()
  }
  return globalBot
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'send_chat': {
        const b = ensureBot()
        if (!b) return { content: [{ type: 'text', text: '未连接' }] }
        b.chat(args.message)
        return { content: [{ type: 'text', text: `已发送: ${args.message}` }] }
      }
      // ...
    }
  }
})
```

---

#### 1.3 缺少 TypeScript 类型定义

**位置**: 项目根目录

**问题**:
- 没有任何 `.d.ts` 文件
- IDE 自动补全体验不佳
- 跨文件类型检查缺失

**建议**:
添加 `index.d.ts`：
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
    blockAt(pos: vec3): Block | null
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
  }

  export interface Entity {
    id: number
    name: string
    username?: string
    type: string
    position: vec3
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
  }

  export interface Block {
    name: string
    position: Vec3
    _properties?: Record<string, any>
    shapes?: number[][]
    boundingBox?: string
  }

  export interface InventoryItem {
    name: string
    displayName?: string
    count: number
    type: number
    slot: number
  }

  export function createBot(options: any): Bot
}

export { createBot, getBot, destroyBot } from './lib/bot.mjs'
export * from './lib/nav/index.mjs'
export * from './lib/perception/index.mjs'
```

---

## 2. 中等问题 📌

### 2.1 重启逻辑不稳定

**位置**: `lib/commands.mjs:67-83`

**问题**:
```javascript
if (cmd === '！restart' || cmd === '!restart') {
  bot.destroyBot()
  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: 'inherit'
  })
  child.once('spawn', () => {
    child.unref()
    addMessage(logRaw('正在重启...'))
    setTimeout(() => exit(), 250)  // 250ms 后退出，子进程可能还没真正启动
  })
}
```

- 父进程 `exit()` 与子进程启动之间存在竞态条件
- 如果 250ms 内子进程尚未完全初始化，可能被父进程杀死
- 实际上 `detached` + `unref` 在 Windows 上不能完全独立

**建议**:
```javascript
child.once('spawn', () => {
  child.unref()
  addMessage(logRaw('正在重启...'))
  setTimeout(() => {
    addMessage(logRaw('子进程已启动，父进程退出'))
    exit()
  }, 1000)  // 增加延迟到 1 秒
})
```

---

### 2.2 重复代码

**位置**: `lib/bot.mjs:428-430`, `lib/commands.mjs:254-257`

**问题**:
```javascript
// bot.mjs
function normalizeName(s) {
  return String(s).toLowerCase().replace(/[-_\s]+/g, '')
}

// commands.mjs 中重复定义
if (['！f', '!f', '！前', '!前'].includes(cmd)) {
  bot.setControl('forward', true)
  addMessage(logRaw('▶ 前进中 (!stop 停止)'))
  return true
}
```

**建议**: 提取到 `lib/i18n.mjs` 或新建 `lib/utils.mjs`：
```javascript
// lib/utils.mjs
export function normalizeName(s: string): string {
  return String(s).toLowerCase().replace(/[-_\s]+/g, '')
}

export function formatDistance(dist: number): string {
  return dist.toFixed(1)
}
```

---

### 2.3 变量命名不精确

**位置**: `lib/nav/controller.mjs:283-316`

**问题**:
```javascript
function goto(x, y, z) {
  const gx = Math.floor(x)
  const gy = Math.floor(y)
  const gz = Math.floor(z)
  // ...
  state.goal = { x: gx, y: gy, z: gz }
```

`goto` 函数参数已经传入坐标，再转换成 `gx`/`gy`/`gz` 只是为了避免污染全局变量，但实际上：
1. 转换参数有微小误差（不取整也能正确工作）
2. 命名反而让代码更难读

**建议**:
```javascript
function goto(targetX, targetY, targetZ) {
  // 使用 Math.floor 而不是单独变量
  state.goal = {
    x: Math.floor(targetX),
    y: Math.floor(targetY),
    z: Math.floor(targetZ)
  }
  // ...
}
```

---

### 2.4 错误处理不完整

**位置**: `lib/bot.mjs:365-382`

**问题**:
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
  bot.sleep(bed, (err) => {
    if (err) {
      if (onMessageCallback) onMessageCallback('sleep_failed', { err: err.message })
    }
  })
  return 'sleeping'  // 回调异步执行，这里立即返回 'sleeping' 不够准确
}
```

- 异步操作完成后才真正进入睡眠状态
- 调用方无法立即知道是否真正成功

**建议**:
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

  // 返回 Promise 让调用方可以等待
  return new Promise((resolve, reject) => {
    bot.sleep(bed, (err) => {
      if (err) {
        reject(new Error(err.message))
      } else {
        resolve('sleeping')
      }
    })
  })
}
```

---

### 2.5 资源泄漏风险

**位置**: `lib/bot.mjs:25-36`

**问题**:
```javascript
function quitBot() {
  if (!bot) return
  try {
    if (typeof bot.quit === 'function') {
      bot.quit()
    } else if (typeof bot.end === 'function') {
      bot.end()
    } else if (bot._client && typeof bot._client.end === 'function') {
      bot._client.end()
    }
  } catch {}
  // 没有清理 bot 对象本身，且没有清理 nav
}
```

- 异常被静默吞掉，没有日志记录
- 没有确保资源完全释放

**建议**:
```javascript
function quitBot() {
  if (!bot) return
  try {
    if (typeof bot.quit === 'function') {
      bot.quit()
    } else if (typeof bot.end === 'function') {
      bot.end()
    } else if (bot._client && typeof bot._client.end === 'function') {
      bot._client.end()
    }

    // 等待一下确保连接关闭
    return new Promise(resolve => setTimeout(resolve, 100))

  } catch (err) {
    console.error('quitBot error:', err)
    throw err  // 不再静默吞掉错误
  }
}
```

---

### 2.6 异步调用无反馈

**位置**: `lib/commands.mjs:512-533`

**问题**:
```javascript
const doPlace = () => {
  let reference = null
  let face = null
  for (const f of FACES) {
    const neighbor = bot.blockAt(target.plus(vec3(...f.offset)))
    // ...
  }
  // ...

  bot.equip(item, 'hand', (err) => {
    if (err) {
      if (onMessageCallback) onMessageCallback('place_failed', { err: err.message })
      return
    }
    bot.placeBlock(reference, face, (placeErr) => {
      if (placeErr) {
        if (onMessageCallback) onMessageCallback('place_failed', { err: placeErr.message })
      } else if (onMessageCallback) {
        onMessageCallback('block_placed', { name: blockName, x: target.x, y: target.y, z: target.z })
      }
    })
  })
}

if (standX != null && standY != null && standZ != null) {
  // ... 等待走到位置
  const checkInterval = setInterval(() => {
    if (!bot || !bot.entity) {
      clearInterval(checkInterval)
      return
    }
    if (bot.entity.position.distanceTo(stand) <= 2.5) {
      clearInterval(checkInterval)
      if (nav) nav.stop()
      setTimeout(doPlace, 300)  // 异步执行，无法返回成功状态
    }
  }, 500)
  return { ok: true, name: blockName, walking: true }
}

doPlace()
return { ok: true, name: blockName }  // 不等 placeBlock 完成
```

**问题**:
- `placeBlock` 异步执行但立即返回
- 调用方无法知道放置是否真正成功
- TUI/CLI 无法显示实时反馈

**建议**:
```javascript
export function placeBlock(blockName, x, y, z, standX, standY, standZ) {
  if (!bot) return { ok: false, reason: '未连接' }

  const target = vec3(Math.floor(x), Math.floor(y), Math.floor(z))
  const existing = bot.blockAt(target)
  if (existing && existing.name !== 'air' && existing.name !== 'water' && existing.name !== 'lava') {
    return { ok: false, reason: `目标位置已有方块: ${existing.name}` }
  }

  const items = bot.inventory.items()
  const zhId = blockIdFromZh(blockName)
  let item = items.find(i =>
    i.name === blockName || i.name === `minecraft:${blockName}` ||
    (zhId && (i.name === zhId || i.name === `minecraft:${zhId}`))
  )
  if (!item) return { ok: false, reason: `背包里没有方块: ${blockName}` }

  return new Promise((resolve) => {
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
        resolve({ ok: false, reason: '目标位置周围没有可放置的支撑面' })
        return
      }

      bot.equip(item, 'hand', (err) => {
        if (err) {
          resolve({ ok: false, reason: err.message || '装备物品失败' })
          return
        }
        bot.placeBlock(reference, face, (placeErr) => {
          if (placeErr) {
            resolve({ ok: false, reason: placeErr.message })
          } else {
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
            resolve({ ok: false, reason: '未连接' })
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

### 2.7 资源缓存管理不当

**位置**: `lib/nav/world.mjs:107-134`

**问题**:
```javascript
export function createWorld(blockAtFn, minY = -64) {
  const pos = { x: 0, y: 0, z: 0 }
  const cache = new Map()

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
    clearCache() { cache.clear() }  // 只提供 clearCache，没有自动清理机制
  }
  return world
}
```

- `clearCache()` 需要手动调用
- 如果世界加载，缓存会无限增长
- 没有清理过期缓存（如超出加载范围的格子）

**建议**:
```javascript
export function createWorld(blockAtFn, minY = -64, worldSize = 96) {
  const pos = { x: 0, y: 0, z: 0 }
  const cache = new Map()

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

  // 定期清理超出范围的缓存
  setInterval(() => {
    for (const key of cache.keys()) {
      const [cx, cy, cz] = key.split(',').map(Number)
      const dist = Math.hypot(cx, cz)
      if (dist > worldSize / 2) {
        cache.delete(key)
      }
    }
  }, 60000)  // 每分钟清理一次

  const world = {
    minY,
    getCell: getCellP,
    clearCache() { cache.clear() }
  }
  return world
}
```

---

### 2.8 TUI 渲染性能问题

**位置**: `tui.mjs:94-102`

**问题**:
```javascript
function buildMapRow(row, width = MAP_W) {
  let out = ''
  for (const cell of row) {
    const bg = cell.bg ? `\x1b[48;5;${rgbTo256(cell.bg[0], cell.bg[1], cell.bg[2])}m` : '\x1b[40m'
    const fg = cell.fg ? `\x1b[38;5;${rgbTo256(cell.fg[0], cell.fg[1], cell.bg[2])}m` : ''
    out += bg + fg + (cell.ch || ' ') + '\x1b[0m'
  }
  return out
}
```

- 每次渲染都重新构建 ANSI 转义序列
- 频繁调用 `rgbTo256` 进行颜色转换
- 没有缓存（如果相同颜色重复出现）

**建议**:
```javascript
const colorCache = new Map()

function rgbTo256(r, g, b) {
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
    const gray = Math.round((r + g + b) / 3)
    if (gray < 8) return 16
    if (gray > 247) return 231
    return 232 + Math.round((gray - 8) / 10)
  }
  const ri = Math.round(r / 51)
  const gi = Math.round(g / 51)
  const bi = Math.round(b / 51)
  return 16 + 36 * ri + 6 * gi + bi
}

function buildMapRow(row, width = MAP_W) {
  let out = ''
  for (const cell of row) {
    if (cell.bg) {
      const key = `${cell.bg[0]},${cell.bg[1]},${cell.bg[2]}`
      let bgCode = colorCache.get(key)
      if (!bgCode) {
        bgCode = `\x1b[48;5;${rgbTo256(...cell.bg)}m`
        colorCache.set(key, bgCode)
      }
      out += bgCode
    } else {
      out += '\x1b[40m'
    }

    if (cell.fg) {
      const key = `${cell.fg[0]},${cell.fg[1]},${cell.fg[2]}`
      let fgCode = colorCache.get(key)
      if (!fgCode) {
        fgCode = `\x1b[38;5;${rgbTo256(...cell.fg)}m`
        colorCache.set(key, fgCode)
      }
      out += fgCode
    }

    out += (cell.ch || ' ') + '\x1b[0m'
  }
  return out
}
```

---

## 3. 次要问题 💡

### 3.1 缺少测试套件

**问题**:
- 没有任何单元测试或集成测试
- 代码改动后只能手动验证

**建议**: 添加测试目录结构：
```
tests/
  nav/
    plan.test.mjs
    world.test.mjs
    controller.test.mjs
  utils.test.mjs
```

示例测试（nav/plan.test.mjs）：
```javascript
import { expect } from 'chai'
import { walkable, planRoute } from '../nav/plan.mjs'
import { createWorld } from '../nav/world.mjs'

describe('walkable', () => {
  it('should return wall for height diff > 1.2', () => {
    const world = createWorld((pos) => {
      if (pos.x === 0 && pos.y === 0 && pos.z === 0) return { name: 'stone', _properties: {} }
      return null
    })
    const result = walkable(world, 0, 0, 0)
    expect(result.ok).to.be.false
  })
})
```

---

### 3.2 包缺少 scripts 脚本

**位置**: `package.json`

**建议**: 添加验证和类型检查脚本：
```json
{
  "scripts": {
    "start": "node index.js",
    "mcp": "node mcp-server.mjs",
    "mcp:sse": "node mcp-server.mjs --transport=sse",
    "mcp:stdio": "node mcp-server.mjs --transport=stdio",
    "verify": "node --check index.js && node --check lib/**/*.mjs",
    "lint": "eslint . --ext .mjs",
    "type-check": "tsc --noEmit index.d.ts"
  }
}
```

---

### 3.3 文档拼写错误

**位置**: `lib/bot.mjs:7, 28, 85`

**问题**:
```javascript
// 行 7
let nav = null
// 行 28
bot.quit()
// 行 85
bot.on('spawn', () => {
```

- 注释 `// 行 X` 应该删除，不应出现在生产代码中
- 导致代码看起来未完成

**建议**: 删除所有调试注释

---

### 3.4 未使用的代码

**位置**: `lib/nav/line.mjs`, `detour.mjs`, `smooth.mjs`

**问题**:
```javascript
// index.mjs
export { checkLine } from './line.mjs'
export { findDetour, searchOnce } from './detour.mjs'
export { smoothPath } from './smooth.mjs'
export { createWorld, groundAt, bodyClearAt, blockInfo } from './world.mjs'
```

- `line.mjs`, `detour.mjs`, `smooth.mjs` 被 `index.mjs` 导出
- 但只在索引中引用，未在 `plan.mjs` 或 `controller.mjs` 中使用
- 标记为"遗留：预规划时代，已不引用（待删）"

**建议**: 如果确定不再使用，删除这些文件并更新 `index.mjs`

---

### 3.5 代码风格不一致

**位置**: 全局

**问题**:
- `bot.setControl('forward', true)` vs `bot.setControlState('forward', true)`
- `bot.isSleeping` vs `bot.isSleeping`（一致）
- `bot.toss()` vs `bot.toss`（函数名）

**建议**: 统一使用 mineflayer API 文档中的标准方法名

---

### 3.6 MCP 传输模式切换问题

**位置**: `lib/commands.mjs:371-380`

**问题**:
```javascript
if (cmd === '！mcp-stdio' || cmd === '!mcp-stdio') {
  mcpTransport = 'stdio'
  addMessage(logRaw('MCP 传输模式切换为: stdio'))
  return true
}

if (cmd === '！mcp-sse' || cmd === '!mcp-sse') {
  mcpTransport = 'sse'
  addMessage(logRaw('MCP 传输模式切换为: sse'))
  return true
}
```

- 切换模式后不重启 MCP 服务器
- 新启动的服务器使用新模式，但旧服务器仍在运行
- 可能导致多实例竞争

**建议**:
```javascript
if (cmd === '！mcp-stdio' || cmd === '!mcp-stdio') {
  if (mcpTransport === 'stdio') {
    addMessage(logRaw('已经是 stdio 模式'))
  } else {
    mcpTransport = 'stdio'
    if (mcpProcess) {
      mcpProcess.kill()
      mcpProcess = null
      setTimeout(() => {
        startMcpServer()
      }, 100)
    }
  }
  return true
}
```

---

### 3.7 容器化不足

**建议**: 添加 `Dockerfile` 和 `.dockerignore`：
```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN npm start

# 监听 MCP stdio
CMD ["node", "mcp-server.mjs", "--transport=stdio"]
```

---

## 4. 安全性检查

### 4.1 输入验证不足

**位置**: `lib/commands.mjs:163-182`

**问题**:
```javascript
if (cmd.startsWith('！find ') || cmd.startsWith('!find ')) {
  const input = cmd.slice(6).trim()
  const blockName = blockIdFromZh(input) || input
  if (!blockName) {
    addMessage(logRaw('用法: !find <方块名>'))
    return true
  }
  const result = findBlock(blockName, 8)
  // ...
}
```

- 没有对 `input` 进行长度限制
- 可能导致路径遍历攻击（虽然当前场景不适用）

**建议**: 添加输入验证
```javascript
const findMatch = cmd.match(/^(!|！)find\s+([^\s]+)\s*$/)
if (!findMatch) return false

const blockName = findMatch[2].trim()
if (blockName.length > 50) {
  addMessage(logRaw('方块名过长'))
  return true
}
```

---

### 4.2 未过滤用户输入

**位置**: `lib/commands.mjs:254-257`

**问题**:
```javascript
if (['！f', '!f', '！前', '!前'].includes(cmd)) {
  bot.setControl('forward', true)
  addMessage(logRaw('▶ 前进中 (!stop 停止)'))
  return true
}
```

- 用户可以直接输入命令控制机器人
- 虽然当前没有安全问题，但如果 MCP 服务对外开放，可能被滥用

**建议**: 添加命令认证机制（如果需要）

---

### 4.3 日志敏感信息

**位置**: `lib/bot.mjs:112, 219`

**问题**:
```javascript
// 行 112
const plain = message.trim().replace(/\s+\|.*$/, '')
// 行 219
sendChat('/register ' + config.password + ' ' + config.password)
```

- 日志中可能包含敏感信息
- 建议在生产环境禁用调试日志

**建议**:
```javascript
if (process.env.NODE_ENV === 'production') {
  console.log = () => {}  // 禁用所有控制台输出
}
```

---

## 5. 性能建议

### 5.1 避免重复的 `bot.blockAt` 调用

**位置**: `lib/minimap.mjs:97-127`

**问题**:
```javascript
function sampleColumn(bot, wx, wz, scanTop, bottomY) {
  let waterDepth = 0
  let inIce = false
  let sawWater = false
  let surfaceY = scanTop
  for (let y = scanTop; y >= bottomY; y--) {
    const b = blockAt(bot, wx, y, wz)  // 每次循环都调用 bot.blockAt
    if (!b) continue
    // ...
  }
}
```

**建议**: 在 `createWorldFromBot` 中添加缓存层

---

### 5.2 避免频繁日志写入

**位置**: `lib/logger.mjs:9-13`

**问题**:
```javascript
function append(file, line) {
  try {
    fs.appendFileSync(file, line + '\n', 'utf8')
  } catch {}
}
```

**建议**:
- 使用内存缓冲（批量写入）
- 或使用更高效的日志库（如 `winston`）

---

## 6. 用户体验问题

### 6.1 放置方块无即时反馈

**位置**: `lib/commands.mjs:512-533`

**问题**: 已在 2.6 节详细说明

**建议**: 将 `placeBlock` 改为返回 Promise，让 TUI/CLI 能够等待完成

---

### 6.2 聊天指令响应延迟

**位置**: `lib/bot.mjs:118-210`

**问题**:
- 用户发送 `LanBot move 10 10 10`
- bot.mjs 中匹配到命令后调用 `moveTo()`
- 然后通过 `onMessageCallback` 回调
- UI 层收到回调才打印响应
- 用户等待时间较长

**建议**: 直接在匹配到命令时立即返回，不要等待 `moveTo()` 完成

---

### 6.3 TUI 光标位置问题

**位置**: `tui.mjs:196-198`

**问题**:
```javascript
process.stdout.write('\x1b[1;1H\x1b[0m')
process.stdout.write(lines.join('\r\n') + '\x1b[0m')
writeAt(cursorCol, rows, '')
```

- 多次调用 `process.stdout.write` 会在 TUI 中留下残影
- 建议使用单次重绘或更高效的 TUI 库（如 `blessed`）

---

## 7. 代码规范检查

### 7.1 未使用的导入

**位置**: 全局

**问题**:
- 可能存在未使用的导入
- 建议：使用 `eslint-plugin-unused-imports` 自动检测

---

### 7.2 缺少 JSDoc 注释

**位置**: `lib/plan.mjs`, `lib/world.mjs`

**建议**: 为所有导出函数添加 JSDoc
```javascript
/**
 * 检查格子是否可走
 * @param {Object} world - 世界对象
 * @param {number} x - X 坐标
 * @param {number} z - Z 坐标
 * @param {number} feetY - 脚高
 * @returns {{ok: boolean, reason?: string, action?: string, feetY: number, diff: number}} 可走性结果
 */
export function walkable(world, x, z, feet) {
  // ...
}
```

---

### 7.3 魔法数字

**位置**: `lib/nav/controller.mjs`

**建议**: 提取为常量并添加注释
```javascript
const TICK_MS = 100              // 节拍间隔（毫秒）
const STUCK_MS = 3000            // 卡住检测阈值
const STUCK_DIST = 0.3           // 卡住距离阈值
const OPEN_CD = 900              // 开门右键冷却（毫秒）
const OPEN_WAIT_MS = 5000        // 等门打开超时（毫秒）
const PASS_MS = 150              // 穿门侧移时长（毫秒）
const REPLAN_CD = 500            // 重新规划最小间隔（毫秒）
const JUMP_SPOT_MS = 400         // 直行卡住点跳时长（毫秒）
const MAX_JUMP_TRIES = 3         // 跳跃尝试次数
const TIMEOUT_MS = 600000        // 总超时（毫秒，10 分钟）
const PLAN_RANGE = 48            // 规划范围
```

---

## 8. 测试覆盖率建议

### 8.1 核心功能测试矩阵

| 模块 | 单元测试 | 集成测试 | 端到端测试 | 当前覆盖率 |
|------|---------|---------|-----------|-----------|
| bot.mjs | ✓ | ✓ | ✓ | 0% |
| nav/plan.mjs | ✓ | ✓ | - | 0% |
| nav/controller.mjs | ✓ | ✓ | - | 0% |
| nav/world.mjs | ✓ | - | - | 0% |
| perception/scan.mjs | ✓ | ✓ | - | 0% |
| perception/monitor.mjs | ✓ | - | - | 0% |
| commands.mjs | - | ✓ | - | 0% |
| tui.mjs | - | ✓ | - | 0% |

---

## 9. 优先修复建议

### 高优先级 🔴

1. **修复 MCP 服务器状态管理**（2.2）
   - 影响：资源泄漏、并发问题
   - 工作量：1-2 小时

2. **密码明文存储**（1.1）
   - 影响：安全隐患
   - 工作量：2-4 小时

3. **添加类型定义**（1.3）
   - 影响：开发体验、代码质量
   - 工作量：2-3 小时

### 中优先级 🟡

4. **错误处理改进**（2.4, 2.5, 2.6）
   - 影响：可靠性、用户体验
   - 工作量：4-6 小时

5. **重启逻辑优化**（2.1）
   - 影响：稳定性
   - 工作量：30 分钟

6. **资源缓存管理**（2.7）
   - 影响：长期运行内存泄漏
   - 工作量：2-3 小时

### 低优先级 🟢

7. **添加测试套件**（3.1）
   - 影响：代码质量、可维护性
   - 工作量：8-16 小时

8. **文档完善**（3.4, 3.6, 7.2）
   - 影响：可维护性
   - 工作量：4-6 小时

---

## 10. 总体评分

| 维度 | 评分 (1-10) | 说明 |
|------|------------|------|
| 架构设计 | 8/10 | 模块化清晰，职责分离良好 |
| 代码质量 | 6/10 | 存在重复代码、命名不一致等问题 |
| 错误处理 | 5/10 | 部分异步操作无反馈，异常被静默吞掉 |
| 安全性 | 4/10 | 密码明文存储，缺少输入验证 |
| 性能 | 7/10 | 自研引擎优化良好，但有缓存问题 |
| 可维护性 | 6/10 | 缺少测试、文档，部分代码遗留 |
| 用户体验 | 6/10 | 异步操作反馈不足 |
| **总体评分** | **6.1/10** | **良好，但有改进空间** |

---

## 11. 总结

mcbot 是一个架构清晰、功能完善的 Minecraft 机器人项目。自研导航引擎设计良好，事件驱动架构灵活。但存在以下关键问题需要改进：

### 必须修复 🚨
1. **密码明文存储** → 使用环境变量或加密
2. **MCP 服务器状态管理** → 添加全局 bot 实例
3. **缺少类型定义** → 添加 TypeScript 声明

### 强烈建议 💪
4. **错误处理完善** → 异步操作返回 Promise
5. **资源管理优化** → 自动清理缓存
6. **添加测试套件** → 提高代码质量

### 优化项 🔧
7. 重启逻辑稳定性
8. 代码重复消除
9. 文档完善
10. 性能优化（TUI 渲染、日志批量写入）

修复上述问题后，项目将达到 **8/10** 的水平，具备生产级代码质量。
