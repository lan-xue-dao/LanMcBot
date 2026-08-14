// lib/nav/plan.mjs
// 路线规划：从「直连目标」的直线路线出发，直线被挡时用 A* 逐步演化，
// 直到得到一条途径路线无障碍且到达目标点最短的路线（路径上允许标记可交互方块）。
//
// 可走性模型（与 controller 执行共用 walkable）：
//   高度差 +1.2 内走/跳（单格高台阶/方块 = 可越过，diff>0.5 需跳）、-4 内可落；
//   可通过位置 = 脚下可站立（groundAt 有 standable）+ 站立处向上净空 ≥2 格且两格均为可通过方块
//   （穿透物：木门按开关状态、活板门/压力板/按钮/告示牌始终可穿）；
//   关着的非铁门：可走但需先开门（action:'open'）；开着的门：可走但需侧向偏移穿过（action:'door'）。
//
// 返回路点数组 [{x,y,z,action}]（含终点，不含起点；x/y/z 为整数格坐标，y 为该格站立脚高）；
// 无解返回 null。

import { groundAt } from './world.mjs'

const MAX_JUMP_UP = 1.2
const MAX_DROP = 4
const STEP_COST = 1
const DIAG_COST = 1.414
const RISE_COST = 0.5       // 每上升 1 格额外代价（优先平地/下楼）
const OPEN_COST = 2         // 经过需开门的格子代价（尽量绕开，但不至于断链）

// 单格可走判定（规划与执行共用）
// 返回 { ok, reason|action, feetY, diff }
//   ok=false, reason: 'cliff'|'wall'
//   ok=true,  action: null | 'open'（关着的门，需要开门后过） | 'door'（开着的门，偏移穿过）
export function walkable(world, x, z, feet) {
  const ground = groundAt(world, x, z, feet + 3, feet - MAX_DROP)
  if (!ground) return { ok: false, reason: 'cliff' }
  const diff = ground.feetY - feet
  if (diff > MAX_JUMP_UP) return { ok: false, reason: 'wall' }
  if (diff < -MAX_DROP) return { ok: false, reason: 'cliff' }
  const y = ground.feetY
  const c1 = world.getCell(x, y, z)
  const c2 = world.getCell(x, y + 1, z)
  const blocked = [c1, c2].find(c => !c.bodyClear || c.avoid || (c.liquid && c.name === 'lava'))
  if (blocked) {
    if (blocked.needsOpen) return { ok: true, action: 'open', feetY: y, diff }
    return { ok: false, reason: 'wall' }
  }
  // 开着的门：可穿过但需侧向偏移（过门框）
  if (c1.openable || c2.openable) return { ok: true, action: 'door', feetY: y, diff }
  return { ok: true, action: null, feetY: y, diff }
}

// 直线尝试：DDA 逐格检查起点→终点连线经过的格子全部可走（含可交互门）
// 返回路点数组或 null
function tryLine(world, sx, sz, feetY, tx, tz, range) {
  let x = sx, z = sz, feet = feetY
  const dx = Math.sign(tx - sx), dz = Math.sign(tz - sz)
  const steps = Math.max(Math.abs(tx - sx), Math.abs(tz - sz))
  if (steps === 0) return null
  const out = []
  for (let i = 1; i <= steps; i++) {
    const nx = x + dx, nz = z + dz
    const w = walkable(world, nx, nz, feet)
    if (!w.ok) return null
    out.push({ x: nx, y: w.feetY, z: nz, action: w.action || null })
    x = nx; z = nz; feet = w.feetY
  }
  if (x !== tx || z !== tz) return null
  return out
}

// 完整路线：先直线，失败则 A* 演化；起点 (sx,sz,feetY) → 终点 (tx,ty,tz)
export function planRoute(world, sx, sz, feetY, tx, ty, tz, maxRange = 48) {
  if (Math.abs(tx - sx) > maxRange || Math.abs(tz - sz) > maxRange) return null
  const tGround = groundAt(world, tx, tz, ty + 3, ty - MAX_DROP)
  if (!tGround || Math.abs(tGround.feetY - ty) > 1.2) return null

  const line = tryLine(world, sx, sz, feetY, tx, tz, maxRange)
  if (line) return line

  const key = (x, z) => x * 65536 + z
  const cameFrom = new Map()
  const open = new Map()
  const closed = new Set()
  const startK = key(sx, sz)
  open.set(startK, { x: sx, z: sz, y: feetY, g: 0, f: Math.hypot(tx - sx, tz - sz) })

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]

  while (open.size) {
    let bestK = null
    let bestF = Infinity
    for (const [k, node] of open) {
      if (node.f < bestF) { bestF = node.f; bestK = k }
    }
    const cur = open.get(bestK)
    open.delete(bestK)
    closed.add(bestK)
    if (cur.x === tx && cur.z === tz) {
      const path = []
      let k = bestK
      while (k !== startK) {
        const c = cameFrom.get(k)
        if (!c) break
        path.unshift({ x: c.x, y: c.y, z: c.z, action: c.action || null })
        k = c.k
      }
      // 目标格已在 cameFrom 中记录过，避免重复
      const last = path[path.length - 1]
      if (!last || last.x !== tx || last.z !== tz) path.push({ x: tx, y: tGround.feetY, z: tz, action: null })
      return path
    }
    const curGround = groundAt(world, cur.x, cur.z, cur.y + 3, cur.y - MAX_DROP)
    const curFeet = curGround ? curGround.feetY : cur.y
    for (const [dx, dz] of DIRS) {
      const nx = cur.x + dx
      const nz = cur.z + dz
      if (Math.abs(nx - sx) > maxRange || Math.abs(nz - sz) > maxRange) continue
      const nk = key(nx, nz)
      if (closed.has(nk) || open.has(nk)) continue
      const w = walkable(world, nx, nz, curFeet)
      if (!w.ok) continue
      const diff = w.feetY - curFeet
      const extra = w.action === 'open' ? OPEN_COST : 0
      const cost = cur.g + (dx !== 0 && dz !== 0 ? DIAG_COST : STEP_COST)
        + (diff > 0 ? diff * RISE_COST : 0) + extra
      const nf = cost + Math.hypot(tx - nx, tz - nz)
      open.set(nk, { x: nx, z: nz, y: w.feetY, g: cost, f: nf })
      cameFrom.set(nk, { k: bestK, x: nx, y: w.feetY, z: nz, action: w.action })
    }
  }
  return null
}
