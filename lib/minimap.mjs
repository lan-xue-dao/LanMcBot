import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadJson(name) {
  let text = fs.readFileSync(path.join(__dirname, 'data', name), 'utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return JSON.parse(text)
}

// MCC 的 Material 名是 PascalCase（AcaciaDoor），mineflayer 方块/实体名是 snake_case
function pascalToSnake(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

const LAVA = [255, 120, 0]
const WATER = [64, 64, 255]
const ICE = [160, 160, 255]
const DEFAULT = [60, 60, 60]
const VOID = [0, 0, 0]
const CAVE_BORDER = [16, 16, 16]
const CAVE_SOLID = [24, 20, 18]
const FADED = [100, 100, 100]
const ENTITY_COLOR = {
  hostile: [255, 68, 68],
  passive: [68, 255, 68],
  neutral: [255, 170, 0],
  player: [255, 255, 255]
}
const ENTITY_PRIORITY = { hostile: 4, player: 3, neutral: 2, passive: 1 }

const BLOCK_COLORS = {}
const TRANSPARENT = new Set(['air', 'cave_air', 'void_air'])
const WATER_SET = new Set(['water'])
const ICE_SET = new Set(['ice', 'packed_ice', 'blue_ice', 'frosted_ice'])
const ENTITY_CATEGORIES = {}

{
  const data = loadJson('minimap_block_colors.json')
  for (const [k, v] of Object.entries(data.colors)) {
    BLOCK_COLORS[pascalToSnake(k)] = [v[0], v[1], v[2]]
  }
  for (const k of data.transparent || []) TRANSPARENT.add(pascalToSnake(k))
  for (const k of data.water || []) WATER_SET.add(pascalToSnake(k))
  for (const k of data.ice || []) ICE_SET.add(pascalToSnake(k))

  const ents = loadJson('minimap_entity_categories.json')
  for (const cat of ['hostile', 'passive', 'neutral', 'non_living']) {
    for (const k of ents[cat] || []) ENTITY_CATEGORIES[pascalToSnake(k)] = cat
  }
}

function blend(top, bottom, t) {
  return [
    Math.round(top[0] * t + bottom[0] * (1 - t)),
    Math.round(top[1] * t + bottom[1] * (1 - t)),
    Math.round(top[2] * t + bottom[2] * (1 - t))
  ]
}

function darken(c, f) {
  return [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)]
}

// vanilla 地图四档亮度：高(255) 正常(220) 低(180) 最低(135)；按与北邻高度差选档
function heightShade(base, delta) {
  const m = delta > 0 ? 255 : delta < 0 ? 180 : 220
  return [Math.round((base[0] * m) / 255), Math.round((base[1] * m) / 255), Math.round((base[2] * m) / 255)]
}

function blockColor(b) {
  if (!b) return null
  const n = b.name
  if (n === 'water' || n === 'flowing_water') return WATER
  if (n === 'lava' || n === 'flowing_lava') return LAVA
  return BLOCK_COLORS[n] || null
}

// 实心（挡光）：对应 MCC IsLightBlocking = Lava || (!transparent && solid)
function isLightBlocking(b) {
  if (!b) return false
  return b.name === 'lava' || (b.boundingBox === 'block' && !WATER_SET.has(b.name))
}

// mineflayer blockAt 只接受带 x/y/z 的对象（three 数字会静默返回 null，历史上踩过）
const blkPos = { x: 0, y: 0, z: 0 }
function blockAt(bot, x, y, z) {
  blkPos.x = x
  blkPos.y = y
  blkPos.z = z
  return bot.blockAt(blkPos)
}

// 每列从 scanTop 往下扫第一个非透明方块；水按深度混底、冰叠色（对应 MCC SampleColumn）
function sampleColumn(bot, wx, wz, scanTop, bottomY) {
  let waterDepth = 0
  let inIce = false
  let sawWater = false
  let surfaceY = scanTop
  for (let y = scanTop; y >= bottomY; y--) {
    const b = blockAt(bot, wx, y, wz)
    if (!b) continue
    const n = b.name
    if (TRANSPARENT.has(n)) continue
    if (WATER_SET.has(n)) {
      if (!sawWater) {
        surfaceY = y
        sawWater = true
      }
      waterDepth++
      continue
    }
    if (ICE_SET.has(n) && !inIce) {
      if (!sawWater) surfaceY = y
      inIce = true
    }
    const base = blockColor(b) || DEFAULT
    let c = base
    if (waterDepth > 0) c = blend(WATER, c, Math.min(0.85, 0.35 + waterDepth * 0.08))
    if (inIce) c = blend(ICE, c, 0.35)
    return { color: c, surfaceY }
  }
  if (waterDepth > 0) return { color: WATER, surfaceY }
  return { color: null, surfaceY: bottomY }
}

function findCaveFloorY(bot, wx, wz, playerY, maxY, minY) {
  const start = blockAt(bot, wx, playerY, wz)
  const startAir = !(start && isLightBlocking(start))
  if (startAir) {
    for (let y = playerY - 1; y >= minY; y--) {
      const b = blockAt(bot, wx, y, wz)
      if (b && isLightBlocking(b)) return y
    }
    return minY
  } else {
    const upLimit = Math.min(playerY + 10, maxY)
    for (let y = playerY + 1; y <= upLimit; y++) {
      const b = blockAt(bot, wx, y, wz)
      if (!b || !isLightBlocking(b)) {
        for (let y2 = y - 1; y2 >= minY; y2--) {
          const b2 = blockAt(bot, wx, y2, wz)
          if (b2 && isLightBlocking(b2)) return y2
        }
        return minY
      }
    }
    return Number.MIN_SAFE_INTEGER
  }
}

// 洞穴模式列采样（MCC SampleColumnCave）：从玩家 Y 找洞穴地板并压暗
function sampleColumnCave(bot, wx, wz, playerY, maxY, minY) {
  const fy = findCaveFloorY(bot, wx, wz, playerY, maxY, minY)
  if (fy === Number.MIN_SAFE_INTEGER) {
    const fallback = sampleColumn(bot, wx, wz, maxY, minY)
    return { color: CAVE_SOLID, surfaceY: fallback.surfaceY, inCave: false }
  }
  const b = blockAt(bot, wx, fy, wz)
  if (!b) return { color: CAVE_SOLID, surfaceY: fy, inCave: false }
  return { color: darken(blockColor(b) || DEFAULT, 0.55), surfaceY: fy, inCave: true }
}

export function getMinimap(bot, opts = {}) {
  if (!bot || !bot.entity || !bot.registry) return null
  const width = opts.width || 11
  const heightPx = opts.height || width * 2
  const bpp = opts.bpp || 1
  const caveOpt = opts.caveMode || 'auto'

  const p = bot.entity.position
  if (!p) return null
  const playerX = p.x
  const playerY = p.y
  const playerZ = p.z
  const cx = Math.round(playerX)
  const cz = Math.round(playerZ)

  const game = bot.game || {}
  const topY = game.minY != null && game.height != null ? game.minY + game.height - 1 : 254
  const bottomY = game.minY != null ? game.minY : 0
  const scanTop = Math.min(playerY + 32, topY)

  const halfW = Math.floor(width / 2)
  const halfH = Math.floor(heightPx / 2)

  // 洞穴模式自动判定：下界（hasCeiling）或玩家上方有实心方块
  let caveMode = false
  if (caveOpt !== 'off') {
    if (caveOpt === 'on') caveMode = true
    else {
      const dim = (game.dimension || '').toString()
      if (/the_nether/.test(dim)) caveMode = true
      else {
        for (let y = playerY + 2; y <= scanTop; y++) {
          const b = blockAt(bot, cx, y, cz)
          if (b && isLightBlocking(b)) {
            caveMode = true
            break
          }
        }
      }
    }
  }

  // 实体像素（优先级覆盖，对应 MCC entityPixels）
  const entityPixels = new Map()
  const entityKey = (px, py) => px + ',' + py
  if (bot.entities) {
    for (const id in bot.entities) {
      const e = bot.entities[id]
      if (!e || e === bot.entity || !e.position) continue
      let category
      if (e.type === 'player') category = 'player'
      else if (e.type === 'mob' || e.type === 'hostile' || e.type === 'neutral' || e.type === 'passive') {
        category = ENTITY_CATEGORIES[pascalToSnake(e.name || '')] || ''
      }
      if (!category || category === 'non_living') continue
      if (category !== 'player' && e.position.y < playerY - 15) continue

      const px = halfW + Math.round((e.position.x - playerX) / bpp)
      const py = halfH + Math.round((e.position.z - playerZ) / bpp)
      if (px < 0 || px >= width || py < 0 || py >= heightPx) continue

      let c = ENTITY_COLOR[category]
      if (category !== 'player') {
        const depth = playerY - e.position.y
        if (depth > 5) c = depth >= 15 ? FADED : blend(ENTITY_COLOR[category], FADED, (depth - 5) / 10)
      }
      const priority = ENTITY_PRIORITY[category]
      const key = entityKey(px, py)
      const prev = entityPixels.get(key)
      if (!prev || priority > prev.priority) entityPixels.set(key, { color: c, priority })
    }
  }
  entityPixels.set(entityKey(halfW, halfH), { color: ENTITY_COLOR.player, priority: 99 })

  // 地形采样
  const pixels = Array.from({ length: heightPx }, () => Array(width).fill(VOID))
  const heights = Array.from({ length: heightPx }, () => Array(width).fill(bottomY))
  const caveMask = Array.from({ length: heightPx }, () => Array(width).fill(false))

  for (let py = 0; py < heightPx; py++) {
    for (let px = 0; px < width; px++) {
      const wx = cx + (px - halfW) * bpp
      const wz = cz + (py - halfH) * bpp
      let r
      if (caveMode) {
        r = sampleColumnCave(bot, wx, wz, playerY, scanTop, bottomY)
        if (r.inCave) caveMask[py][px] = true
      } else {
        r = sampleColumn(bot, wx, wz, scanTop, bottomY)
      }
      heights[py][px] = r.surfaceY
      pixels[py][px] = r.color || VOID
    }
  }

  // 洞穴描边：非洞穴像素邻接洞穴 → 深色边框（对应 MCC ApplyCaveBorder）
  if (caveMode) {
    for (let py = 0; py < heightPx; py++) {
      for (let px = 0; px < width; px++) {
        if (caveMask[py][px]) continue
        const near =
          (px > 0 && caveMask[py][px - 1]) ||
          (px < width - 1 && caveMask[py][px + 1]) ||
          (py > 0 && caveMask[py - 1][px]) ||
          (py < heightPx - 1 && caveMask[py + 1][px])
        if (near) pixels[py][px] = CAVE_BORDER
      }
    }
  }

  // 高度差浮雕（北邻，对应 MCC ApplyHeightShade）
  for (let py = 0; py < heightPx; py++) {
    for (let px = 0; px < width; px++) {
      if (entityPixels.has(entityKey(px, py))) continue
      const north = py > 0 ? heights[py - 1][px] : heights[py][px]
      pixels[py][px] = heightShade(pixels[py][px], heights[py][px] - north)
    }
  }

  // 实体像素覆盖地形
  for (const [key, e] of entityPixels) {
    const [px, py] = key.split(',').map(Number)
    pixels[py][px] = e.color
  }

  // 打包成终端行：每行 = 上下两个像素，▀ 半块 + fg/bg 双色
  const rows = []
  for (let r = 0; r < heightPx / 2; r++) {
    const row = []
    for (let c = 0; c < width; c++) {
      row.push({ ch: '▀', fg: pixels[r * 2][c], bg: pixels[r * 2 + 1][c] })
    }
    rows.push(row)
  }
  return rows
}
