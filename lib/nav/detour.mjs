// lib/nav/detour.mjs
// 最小偏差绕障搜索：列式（x,z,站立高）A*。
//   直线被挡时，在「距直线窗口」内搜索代价 = 步数 + λ·偏差² 的路径 —— 贴着直线绕，能绕就回直线。
//   窗口递增（window 每次 +4，上限 maxWindow）；搜不到就扩大，绕行路线逐步"优化"。
//   v1 能力：水平行走（8 向）、跳 1 高台阶、落 ≤maxDrop、爬梯子/游泳升降、穿门/栅栏门（needsOpen 标记）。
//   不挖不搭（对应 pathfinder canDig=false / allow1by1towers=false）。

import { groundAt } from './world.mjs'

const MAX_JUMP_UP = 1.2

const CARD = [
  [1, 0], [-1, 0], [0, 1], [0, -1]
]
const DIAG = [
  [1, 1], [1, -1], [-1, 1], [-1, -1]
]

// 跳起时检查头顶（复刻 line.mjs 语义）
function bodyClearJump(world, x, feetY, z, jump) {
  if (jump) {
    const c3 = world.getCell(x, feetY + 2, z)
    if (!c3.bodyClear) return false
  }
  return true
}

function nodeKey(x, z, y) {
  return x + ',' + z + ',' + y
}

// 单格穿越检查：返回 { ok, open } open = 需要开门的格坐标
// 关闭的非铁门（门体占上下两格）允许穿过，但标记开门动作
function canTraverse(world, x, feetY, z) {
  const c1 = world.getCell(x, feetY, z)
  const c2 = world.getCell(x, feetY + 1, z)
  if (c1.avoid || c2.avoid) return { ok: false }
  if (c1.name === 'lava' || c2.name === 'lava') return { ok: false }
  const lazy1 = c1.needsOpen
  const lazy2 = c2.needsOpen
  if (c1.bodyClear && c2.bodyClear) return { ok: true }
  if (lazy1 || lazy2) {
    const ok1 = c1.bodyClear || lazy1
    const ok2 = c2.bodyClear || lazy2
    if (ok1 && ok2) {
      return { ok: true, open: lazy1 ? { x, y: feetY, z } : { x, y: feetY + 1, z } }
    }
  }
  return { ok: false }
}

// 绕障主入口：窗口递增搜索，搜不到就扩大窗口（路线逐步优化）
export function findDetour(world, start, target, opts = {}) {
  const maxDrop = opts.maxDrop ?? 4
  const window = opts.window ?? 8
  const maxWindow = opts.maxWindow ?? 40
  const lambda = opts.lambda ?? 0.12
  const sx = opts.sx ?? start.x
  const sz = opts.sz ?? start.z
  let w = Math.max(2, window)

  while (true) {
    const res = searchOnce(world, start, target, maxDrop, w, lambda, sx, sz)
    if (res) return { ...res, window: w }
    if (w >= maxWindow) return { status: 'fail', window: w }
    w += 4
  }
}

// 单次窗口搜索；失败返回 null
export function searchOnce(world, start, target, maxDrop, W, lambda, sx, sz) {
  const tx = target.x
  const tz = target.z
  const startKey = nodeKey(start.x, start.z, start.feetY)

  const tGround = groundAt(world, tx, tz, start.feetY + 3, start.feetY - maxDrop)
  if (!tGround) return null

  // 简单二叉堆（按 f 值）实现优先队列
  const heap = []
  const heapPos = new Map()
  const gScore = new Map()
  const came = new Map()
  const closed = new Set()
  let expands = 0
  const MAX_EXPANDS = 60000

  const goalKey = nodeKey(tx, tz, tGround.feetY)

  function heapPush(key, f) {
    heap.push([f, key])
    heapPos.set(key, heap.length - 1)
    // 上浮
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      swap(i, p)
      i = p
    }
  }

  function heapPop() {
    const top = heap[0]
    const last = heap.pop()
    heapPos.delete(top[1])
    if (heap.length > 0) {
      heap[0] = last
      heapPos.set(last[1], 0)
      // 下沉
      let i = 0
      while (true) {
        const l = i * 2 + 1
        const r = i * 2 + 2
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        swap(i, m)
        i = m
      }
    }
    return top
  }

  function swap(i, j) {
    const tmp = heap[i]
    heap[i] = heap[j]
    heap[j] = tmp
    heapPos.set(heap[i][1], i)
    heapPos.set(heap[j][1], j)
  }

  function heuristic(x, z, f) {
    const dx = Math.abs(x - tx)
    const dz = Math.abs(z - tz)
    const oct = Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)
    return oct + Math.abs(f - tGround.feetY) * 0.6
  }

  heapPush(startKey, heuristic(start.x, start.z, start.feetY))
  gScore.set(startKey, 0)
  came.set(startKey, null)

  while (heap.length > 0) {
    const [, key] = heapPop()
    if (closed.has(key)) continue
    closed.add(key)
    if (key === goalKey) {
      const opens = []
      const path = reconstruct(came, key, startKey, opens)
      return { path, opens, status: 'found' }
    }

    if (++expands > MAX_EXPANDS) return null

    const [x, z, y] = key.split(',').map(Number)
    const g = gScore.get(key)
    // 偏差代价：离直线（sx,sz→tx,tz）的垂直距离
    const dev = distToSegment(x, z, sx, sz, tx, tz)
    const devCost = lambda * dev * dev

    const tryMove = (nx, nz, cost, isDiag) => {
      if (Math.abs(nx - sx) > W || Math.abs(nz - sz) > W) return
      if (closed.has(nodeKey(nx, nz, y))) return
      if (isDiag) {
        // 斜向：两轴邻格也需可达（不切墙角）
        const g1 = groundAt(world, nx, z, y + 3, y - maxDrop)
        const g2 = groundAt(world, x, nz, y + 3, y - maxDrop)
        if (!g1 || !g2) return
        const d1 = g1.feetY - y
        const d2 = g2.feetY - y
        if (d1 > MAX_JUMP_UP || d1 < -maxDrop || d2 > MAX_JUMP_UP || d2 < -maxDrop) return
        if (!canTraverse(world, nx, g1.feetY, z).ok || !canTraverse(world, x, g2.feetY, nz).ok) return
      }
      const ground = groundAt(world, nx, nz, y + 3, y - maxDrop)
      if (!ground) return
      const diff = ground.feetY - y
      if (diff > MAX_JUMP_UP || diff < -maxDrop) return
      const trav = canTraverse(world, nx, ground.feetY, nz)
      if (!trav.ok) return
      const jump = diff > 0.5
      if (!bodyClearJump(world, nx, ground.feetY, nz, jump)) return
      const nKey = nodeKey(nx, nz, ground.feetY)
      if (closed.has(nKey)) return
      const ng = g + cost + (jump ? 0.3 : 0) + devCost * cost
      const old = gScore.get(nKey)
      if (old !== undefined && old <= ng) return
      gScore.set(nKey, ng)
      came.set(nKey, { x, y, z, open: trav.open })
      const f = ng + heuristic(nx, nz, ground.feetY)
      if (heapPos.has(nKey)) {
        heapPush(nKey, f) // 简单处理：重复插入，closed 去重
      } else {
        heapPush(nKey, f)
      }
    }

    for (const [dx, dz] of CARD) {
      tryMove(x + dx, z + dz, 1, false)
    }
    for (const [dx, dz] of DIAG) {
      tryMove(x + dx, z + dz, Math.SQRT2, true)
    }

    // 垂直移动：梯子/水
    const footCell = world.getCell(x, y, z)
    if (footCell.climbable) {
      const up = canTraverse(world, x, y + 1, z)
      if (up.ok) {
        const nKey = nodeKey(x, y + 1, z)
        const ng = g + 1 + devCost
        if (!closed.has(nKey)) {
          const old = gScore.get(nKey)
          if (old === undefined || old > ng) {
            gScore.set(nKey, ng)
            came.set(nKey, { x, y, z, open: null })
            heapPush(nKey, ng + heuristic(x, z, y + 1))
          }
        }
      }
    } else if (footCell.liquid) {
      // 水面/水内：可上浮一格（上面是水或空气均可，需身体可穿过）
      const upCell = world.getCell(x, y + 1, z)
      if (upCell.liquid || upCell.bodyClear) {
        if (upCell.name !== 'lava') {
          const nKey = nodeKey(x, y + 1, z)
          const ng = g + 1 + devCost
          if (!closed.has(nKey)) {
            const old = gScore.get(nKey)
            if (old === undefined || old > ng) {
              gScore.set(nKey, ng)
              came.set(nKey, { x, y, z, open: null })
              heapPush(nKey, ng + heuristic(x, z, y + 1))
            }
          }
        }
      }
    }
  }

  return null
}

function reconstruct(came, endKey, startKey, opens) {
  const path = []
  let key = endKey
  while (key && key !== startKey) {
    const [x, z, y] = key.split(',').map(Number)
    const prev = came.get(key)
    if (prev && prev.open) opens.push(prev.open)
    path.unshift({ x, z, feetY: y })
    key = prev ? nodeKey(prev.x, prev.z, prev.y) : null
  }
  return path
}

function distToSegment(x, z, ax, az, bx, bz) {
  const abx = bx - ax
  const abz = bz - az
  const len2 = abx * abx + abz * abz
  if (len2 === 0) return Math.hypot(x - ax, z - az)
  let t = ((x - ax) * abx + (z - az) * abz) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(x - (ax + abx * t), z - (az + abz * t))
}
