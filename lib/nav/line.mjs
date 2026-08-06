// lib/nav/line.mjs
// 直线走廊检测：沿目标直线逐格验证「地面可达 + 身体可穿过」，返回直线路径或第一个阻挡格。
// 阻挡判定（保守）：
//   该列无可站表面（深渊/岩浆池/水井）→ 阻挡
//   地面比当前行走高度高 > 1.2（墙/过高台阶）→ 阻挡
//   地面比当前行走高度低 > maxDrop（默认 4，掉入深坑）→ 阻挡
//   脚/身体格被挡或含岩浆/火/蛛网 → 阻挡
//   斜向步进时两轴邻格在当前高度不透明 → 保守视为阻挡（交给 detour 精确搜索）
// 逐格检查 + 缓存，直线模式只做「当前能走多远」，不行就交给 detour。

import { groundAt, bodyClearAt } from './world.mjs'

const MAX_JUMP_UP = 1.2
const MAX_LINE_LOOKAHEAD = 96

// 2D DDA：从 (x0,z0) 到 (x1,z1) 逐格回调，返回遇到的格子数组
// 已修复：起点恰在格子边界向负方向时 tMax=0 导致平局双双步进而过冲死循环
function lineCells(x0, z0, x1, z1) {
  const cells = []
  let x = Math.floor(x0)
  let z = Math.floor(z0)
  const tx = Math.floor(x1)
  const tz = Math.floor(z1)
  const stepX = tx > x ? 1 : (tx < x ? -1 : 0)
  const stepZ = tz > z ? 1 : (tz < z ? -1 : 0)
  const dx = Math.abs(tx - x0)
  const dz = Math.abs(tz - z0)
  let tMaxX = dx === 0 ? Infinity : (tx > x0 ? (x + 1 - x0) : (x0 - x))
  let tMaxZ = dz === 0 ? Infinity : (tz > z0 ? (z + 1 - z0) : (z0 - z))
  const tDeltaX = dx === 0 ? Infinity : 1 / dx
  const tDeltaZ = dz === 0 ? Infinity : 1 / dz

  cells.push({ x, z, diag: false })
  let guard = 0
  while (x !== tx || z !== tz) {
    if (++guard > 100000) throw new Error(`lineCells runaway ${x0},${z0} -> ${x1},${z1}`)
    const prevX = x
    const prevZ = z
    let both = false
    if (x === tx) {
      z += stepZ
      tMaxZ += tDeltaZ
    } else if (z === tz) {
      x += stepX
      tMaxX += tDeltaX
    } else if (tMaxX < tMaxZ) {
      x += stepX
      tMaxX += tDeltaX
    } else if (tMaxZ < tMaxX) {
      z += stepZ
      tMaxZ += tDeltaZ
    } else {
      // 平局：真正的斜向步进（两个轴同时过格边界）
      x += stepX
      z += stepZ
      tMaxX += tDeltaX
      tMaxZ += tDeltaZ
      both = true
    }
    cells.push({ x, z, diag: both || (x !== prevX && z !== prevZ) })
  }
  return cells
}

// 检查从 (x0, y0, z0)（y0 = 当前脚高度）沿直线到 (x1, z1) 的可走性。
// 返回：
//   { ok: true, path: [{x, z, feetY}] }  cell 中心路径（不含起点格），feetY = 每格站立脚高
//   { ok: false, blockedAt: {x, z, feetY}, at: idx }  第一个阻挡格
// 直线长度默认截断到 MAX_LINE_LOOKAHEAD（控制器到达截断点后重新规划，保持搜索有界）
export function checkLine(world, x0, y0, z0, x1, z1, opts = {}) {
  const maxDrop = opts.maxDrop ?? 4
  const lookahead = opts.lookahead ?? MAX_LINE_LOOKAHEAD

  const dx = x1 - x0
  const dz = z1 - z0
  const dist = Math.hypot(dx, dz)
  if (dist < 0.5) return { ok: true, path: [], truncated: false }

  // 截断点：若目标过远，先只规划到截断处
  let endX = x1
  let endZ = z1
  let truncated = false
  if (dist > lookahead) {
    const t = lookahead / dist
    endX = x0 + dx * t
    endZ = z0 + dz * t
    truncated = true
  }

  const cells = lineCells(x0, z0, endX, endZ)
  const path = []
  let h = Math.floor(y0)
  let prevCell = null
  let at = -1

  for (let i = 1; i < cells.length; i++) {
    const c = cells[i]
    at = i
    const ground = groundAt(world, c.x, c.z, h + 3, h - maxDrop)
    if (!ground) {
      return { ok: false, blockedAt: { x: c.x, z: c.z, feetY: h }, at }
    }
    const diff = ground.feetY - h
    if (diff > MAX_JUMP_UP || diff < -maxDrop) {
      return { ok: false, blockedAt: { x: c.x, z: c.z, feetY: h }, at }
    }
    if (!bodyClearAt(world, c.x, ground.feetY, c.z, diff > 0.5)) {
      return { ok: false, blockedAt: { x: c.x, z: c.z, feetY: h }, at }
    }
    if (c.diag && prevCell) {
      // 斜向步进：两轴邻格在当前高度需可穿过（保守，防蹭墙角）
      const ax = prevCell.x
      const az = prevCell.z
      const axz = c.x !== ax ? bodyClearAt(world, c.x, h, az, false) : true
      const azx = c.z !== az ? bodyClearAt(world, ax, h, c.z, false) : true
      if (!axz || !azx) {
        return { ok: false, blockedAt: { x: c.x, z: c.z, feetY: h }, at }
      }
    }
    path.push({ x: c.x, z: c.z, feetY: ground.feetY })
    h = ground.feetY
    prevCell = c
  }

  return { ok: true, path, truncated }
}
