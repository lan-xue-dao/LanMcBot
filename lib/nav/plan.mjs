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
const RISE_COST = 0.8       // 每上升 1 格额外代价（提高，楼梯比开门难）
const OPEN_COST = 1.0       // 经过需开门的格子代价（降低，避免绕远路）

// 最小二叉堆：按 item.f 升序取最小，替代 open 集的线性扫描。
// 等价语义（行为不变）：A* 仍按 f 最小出队；f 相等时靠堆序稳定保持先插入者优先。
// 复杂度由 O(n²) 降到 O(n log n)，不改变产出的路径。
class MinHeap {
  constructor() { this.a = []; this._seq = 0 }
  get size() { return this.a.length }
  // 比较键 [f, seq]：f 相等时按入堆顺序（seq 小者优先），完全复刻原 Map 线性扫描的先入优先语义
  _less(x, y) { return x.f < y.f || (x.f === y.f && x.seq < y.seq) }
  push(item) {
    item.seq = this._seq++
    const a = this.a
    a.push(item)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this._less(a[i], a[p])) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop() {
    const a = this.a
    const top = a[0]
    const last = a.pop()
    if (a.length) {
      a[0] = last
      let i = 0
      const n = a.length
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2
        let s = i
        if (l < n && this._less(a[l], a[s])) s = l
        if (r < n && this._less(a[r], a[s])) s = r
        if (s === i) break
        ;[a[s], a[i]] = [a[i], a[s]]
        i = s
      }
    }
    return top
  }
}

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

  // 字符串键防碰撞：x*65536+z 在 |坐标差|≥65536 时会碰撞（如 x=1,z=65536 与 x=2,z=0）
  const key = (x, z) => `${x},${z}`
  const cameFrom = new Map()
  const open = new MinHeap()
  const gScore = new Map()   // k → 当前最优 g（惰性 decrease-key 的权威值）
  const closed = new Set()
  const startK = key(sx, sz)
  gScore.set(startK, 0)
  open.push({ k: startK, x: sx, z: sz, y: feetY, g: 0, f: Math.hypot(tx - sx, tz - sz) })

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]

  while (open.size) {
    const top = open.pop()
    const bestK = top.k
    // 惰性删除：堆里可能残留同一节点的陈旧条目（g 大于权威值），pop 出来直接跳过
    if (top.g > (gScore.get(bestK) ?? Infinity)) continue
    // closed：已展开的节点不再重复展开（一致于标准 A*，边权非负时首次展开即最优）
    if (closed.has(bestK)) continue
    closed.add(bestK)
    const cur = top
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
      if (closed.has(nk)) continue
      const w = walkable(world, nx, nz, curFeet)
      if (!w.ok) continue
      const diff = w.feetY - curFeet
      const extra = w.action === 'open' ? OPEN_COST : 0
      const cost = cur.g + (dx !== 0 && dz !== 0 ? DIAG_COST : STEP_COST)
        + (diff > 0 ? diff * RISE_COST : 0) + extra
      // 惰性 decrease-key：发现更优 g 时更新权威值并允许重复入堆（新条目 seq 更大，保持平局先入语义）；
      // 陈旧条目 pop 时按 g 对比跳过
      if (cost < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, cost)
        const nf = cost + Math.hypot(tx - nx, tz - nz)
        open.push({ k: nk, x: nx, z: nz, y: w.feetY, g: cost, f: nf })
        cameFrom.set(nk, { k: bestK, x: nx, y: w.feetY, z: nz, action: w.action })
      }
    }
  }
  return null
}
