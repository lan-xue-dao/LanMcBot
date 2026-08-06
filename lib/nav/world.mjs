// lib/nav/world.mjs
// 世界采样辅助：按方块名分类（独立于注册表，可用假世界测试）、列地面扫描、可走性判定
import vec3 from 'vec3'
//
// 模型约定：
//   node = 脚所在格子（cell），站立高度以整数格计。
//   站得住的表面：该格形状最高处 top >= 0.9（整格方块/上半砖/活板门等），且不是栅栏/液体/梯子。
//   身体可穿过（bodyClear）：无形状、形状最高 y2 <= 0.1（地毯/雪1层）、液体（游泳）、
//     可开启物且处于开启态（open）；关闭的栅栏门/木门标记 needsOpen（控制器负责开门）；
//     关闭的铁门/任何 y2 > 0.1 的形状一律不可穿过（含下半砖/雪层，v1 限制，相当于不可挖的墙）。
//   blockAtFn(pos) 内部复用 pos 对象；真实 bot 包装会转成 Vec3（见 createWorldFromBot）。

export const LIQUID_NAMES = new Set(['water', 'lava', 'flowing_water', 'flowing_lava'])
export const CLIMBABLE_NAMES = new Set(['ladder', 'vine'])
export const AVOID_NAMES = new Set(['fire', 'cobweb'])

export function isLiquidName(name) {
  return LIQUID_NAMES.has(name)
}

export function isClimbableName(name) {
  return CLIMBABLE_NAMES.has(name)
}

export function isFenceName(name) {
  // oak_fence 等；fence_gate 不匹配（endsWith('_fence') 为 false）
  return !!name && name.endsWith('_fence')
}

export function isOpenableName(name) {
  return !!name && (name.endsWith('_door') || name.endsWith('_gate'))
}

export function isOpenState(props) {
  if (!props) return false
  const v = props.open
  return v === true || v === 'true' || v === 1 || v === '1'
}

// 由原始方块对象（name/shapes/_properties）计算导航用派生属性
export function blockInfo(block) {
  const name = (block && block.name) || ''
  const props = (block && block._properties) || {}
  const shapes = (block && block.shapes) || []

  const liquid = isLiquidName(name)
  const climbable = isClimbableName(name)
  const fence = isFenceName(name)
  const openable = isOpenableName(name)
  const open = isOpenState(props)
  const avoid = AVOID_NAMES.has(name)
  const ironDoor = openable && name.endsWith('_door') && name.includes('iron')

  let top = 0
  let hasShapes = false
  for (const s of shapes) {
    hasShapes = true
    const f = s ? (typeof s[4] === 'number' ? s[4] : 0) : 0
    if (f > top) top = f
  }

  // 站得住的表面：最高形状 >= 0.9，且不是栅栏/液体/梯子/需避开物/门（门顶薄，不可站）
  const standable = !liquid && !climbable && !fence && !openable && !avoid && top >= 0.9

  // 身体可穿过
  let bodyClear
  if (liquid || climbable) {
    bodyClear = true
  } else if (openable) {
    bodyClear = open
  } else if (!hasShapes) {
    bodyClear = !avoid
  } else {
    bodyClear = !avoid && top <= 0.1
  }

  return {
    name,
    liquid,
    climbable,
    openable,
    open,
    avoid,
iron: ironDoor,
    standable,
    bodyClear,
    needsOpen: openable && !open && !ironDoor,
    top,
    hasShapes
  }
}

// 创建世界访问器：blockAtFn(pos) pos 为 {x,y,z} 复用对象，返回 {name, shapes, _properties} 或 null
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
        name: '', liquid: false, climbable: false, openable: false,
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
    clearCache() { cache.clear() }
  }
  return world
}

// 真实 bot 包装（mineflayer blockAt 必须传真 Vec3，prismarine-world 会调 pos.floored()）
export function createWorldFromBot(bot) {
  const minY = (bot.game && bot.game.minY) || -64
  return createWorld((pos) => bot.blockAt(vec3(pos.x, pos.y, pos.z), false), minY)
}

// 列地面扫描：从 fromY 向下（含）找第一个 standable 表面
// 返回 { feetY: 站立脚高度, cellY: 表面所在格 } 或 null
export function groundAt(world, x, z, fromY, toY) {
  const lo = Math.max(toY, world.minY)
  const hi = Math.max(fromY, world.minY)
  for (let y = hi; y >= lo; y--) {
    const info = world.getCell(x, y, z)
    if (info.standable) {
      return { feetY: y + 1, cellY: y }
    }
  }
  return null
}

// 脚高 feetY 时身体占用格（feetY、feetY+1）是否可穿过；containsLava 检测脚到 head 之间是否有岩浆
export function bodyClearAt(world, x, feetY, z, jumpClear = false) {
  const y = feetY
  const c1 = world.getCell(x, y, z)
  const c2 = world.getCell(x, y + 1, z)
  if (!c1.bodyClear || !c2.bodyClear) return false
  if (c1.avoid || c2.avoid) return false
  if (c1.liquid && c1.name === 'lava') return false
  if (c2.liquid && c2.name === 'lava') return false
  if (jumpClear && !world.getCell(x, y + 2, z).bodyClear) return false
  return true
}