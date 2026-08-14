// lib/nav/controller.mjs
// 路线执行控制器：goto 时先规划完整路线（planRoute：直线演化到 A* 最短无障碍路径），
// 然后沿路点直行；到达需操作的方块（关着的木门）时停下开门再偏移穿过；
// 路线在途中失效（路点不可走/前方出现障碍）→ 障碍前停下重新规划，循环直到到达目标。
//
// 方块规则：
//   可穿透：木门（按开关状态：关着→停下开门，开着→侧向偏移 0.2-0.5 格穿过）、
//           活板门、压力板、按钮、告示牌（始终可走）；
//   可越过（单格高）：高度差 ≤ +1.2 走/跳（diff>0.5 时跳跃）。
//
// 事件（与旧 pathfinder 兼容）：move_started / path_update{status} / path_failed{status} / goal_reached

import { createWorldFromBot } from './world.mjs'
import { planRoute, walkable } from './plan.mjs'
import vec3 from 'vec3'

const TICK_MS = 100
const STUCK_MS = 3000
const STUCK_DIST = 0.3
const MAX_JUMP_UP = 1.2
const MAX_DROP = 4
const OPEN_CD = 900            // 开门右键冷却
const OPEN_WAIT_MS = 5000      // 等门打开超时
const PASS_MS = 150            // 穿门侧移时长（约 0.4 格，符合 0.2-0.5 格偏移）
const REPLAN_CD = 500          // 重新规划最小间隔
const JUMP_SPOT_MS = 400       // 直行卡住点跳时长
const MAX_JUMP_TRIES = 3
const TIMEOUT_MS = 600000      // 总超时 600s（10 分钟）
const PLAN_RANGE = 48          // 规划范围（超出视为未加载/不可达）

export function createController(bot, onEvent) {
  const world = createWorldFromBot(bot)
  const state = {
    goal: null,               // 最终目标 {x,y,z}
    target: null,             // 当前路点 {x,y,z,action}
    queue: [],                // 剩余路点
    mode: 'straight',         // straight | doorpass（穿门偏移）
    passSide: 'left',
    passUntil: 0,
    waitingOpen: null,        // {x,y,z,until} 正在等门打开
    opened: new Set(),
    openUntil: 0,
    replanAt: 0,
    jumpUntil: 0,
    jumpTries: 0,
    stuckSince: 0,
    stuckPos: null,
    startedAt: 0,
    lastStatus: null,
    running: false
  }
  let timer = null

  const emit = (ev, data) => { if (onEvent) onEvent(ev, data) }

  function clearControls() {
    if (!bot) return
    for (const c of ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']) {
      bot.setControlState(c, false)
    }
  }

  function pathStatus(status) {
    if (status !== state.lastStatus) {
      state.lastStatus = status
      emit('path_update', { status })
    }
  }

  function fail() {
    state.target = null
    state.goal = null
    state.queue = []
    state.mode = 'straight'
    state.waitingOpen = null
    clearControls()
    emit('path_failed', { status: 'noPath' })
  }

  function finish() {
    const g = state.goal
    state.target = null
    state.goal = null
    state.queue = []
    state.mode = 'straight'
    state.waitingOpen = null
    clearControls()
    emit('goal_reached', { x: g.x, y: g.y, z: g.z })
  }

  function hovering(p, feet) {
    return !world.getCell(Math.floor(p.x), Math.floor(feet) - 1, Math.floor(p.z)).standable
  }

  function targetYaw(p) {
    const t = state.target
    return Math.atan2(-(t.x + 0.5 - p.x), -(t.z + 0.5 - p.z))
  }

  // 门体格（下半格）是否已打开
  function doorOpen(x, y, z) {
    world.clearCache()
    return world.getCell(x, y, z).open
  }

  function openDoor(x, y, z, now) {
    if (now < state.openUntil) return
    const key = `${x},${y},${z}`
    if (state.opened.has(key)) return
    try {
      const block = bot.blockAt(vec3(x, y, z))
      if (block) bot.activateBlock(block)
      world.clearCache()
    } catch {}
    state.opened.add(key)
    state.openUntil = now + OPEN_CD
  }

  // 穿门偏移侧：选更靠近「穿过门后要去的位置」的一侧
  function pickPassSide(p, yaw) {
    const t = state.queue.length ? state.queue[0] : state.goal
    const lx = Math.cos(yaw), lz = -Math.sin(yaw)
    const rx = -Math.cos(yaw), rz = Math.sin(yaw)
    const dL = Math.hypot(p.x + lx - (t.x + 0.5), p.z + lz - (t.z + 0.5))
    const dR = Math.hypot(p.x + rx - (t.x + 0.5), p.z + rz - (t.z + 0.5))
    return dL <= dR ? 'left' : 'right'
  }

  // 重新规划：从当前位置到最终目标；失败返回 false
  function replan(force) {
    const now = Date.now()
    if (!force && now - state.replanAt < REPLAN_CD) return true
    state.replanAt = now
    if (!bot || !bot.entity || !state.goal) return false
    const p = bot.entity.position
    const feet = p.y
    const path = planRoute(world, Math.floor(p.x), Math.floor(p.z), Math.floor(feet),
      state.goal.x, state.goal.y, state.goal.z, PLAN_RANGE)
    if (!path || !path.length) return false
    state.target = path[0]
    state.queue = path.slice(1)
    state.mode = 'straight'
    state.waitingOpen = null
    state.stuckSince = 0
    state.stuckPos = null
    return true
  }

  function tick() {
    if (!bot || !bot.entity || !state.target) return
    const now = Date.now()
    const p = bot.entity.position
    const t = state.target
    const feet = p.y

    // 总超时
    if (now - state.startedAt > TIMEOUT_MS) {
      pathStatus('noPath')
      fail()
      return
    }

    // 路线失效：当前路点已不可走（新障碍/门又关紧/被破坏）→ 障碍前停下重算
    const tw = walkable(world, t.x, t.z, feet)
    if (!tw.ok) {
      clearControls()
      if (!replan(false)) {
        pathStatus('noPath')
        fail()
      }
      return
    }

    // 前方偏离检测：视线前方 1 格既不是当前路点又不可走 → 路线被新障碍阻断，停下重算
    if (!hovering(p, feet)) {
      const yaw = bot.entity.yaw
      const fx = -Math.sin(yaw)
      const fz = -Math.cos(yaw)
      const cx = Math.floor(p.x + fx)
      const cz = Math.floor(p.z + fz)
      if ((cx !== t.x || cz !== t.z) && !walkable(world, cx, cz, feet).ok) {
        clearControls()
        if (!replan(false)) {
          pathStatus('noPath')
          fail()
        }
        return
      }
    }

    // 等门打开：停住，门开 → 偏移穿过
    if (state.waitingOpen) {
      clearControls()
      if (doorOpen(state.waitingOpen.x, state.waitingOpen.y, state.waitingOpen.z)) {
        state.waitingOpen = null
        const yaw = bot.entity.yaw
        state.passSide = pickPassSide(p, yaw)
        state.passUntil = now + PASS_MS
      } else if (now > state.waitingOpen.until) {
        state.waitingOpen = null
        if (!replan(false)) {
          pathStatus('noPath')
          fail()
        }
      }
      return
    }

    // 到达判据：xz 距路点格心 ≤0.6 且 y 差 ≤1.2
    const horiz = Math.hypot(t.x + 0.5 - p.x, t.z + 0.5 - p.z)

    // 关着的门：接近门格（含门体堵路进不到格心的情况）即停下开门
    if (t.action === 'open' && !doorOpen(t.x, t.y, t.z) && horiz < 1.2) {
      openDoor(t.x, t.y, t.z, now)
      state.waitingOpen = { x: t.x, y: t.y, z: t.z, until: now + OPEN_WAIT_MS }
      clearControls()
      return
    }

    if (horiz <= 0.6 && Math.abs(feet - t.y) <= 1.2) {
      if (state.queue.length) {
        state.target = state.queue.shift()
        return
      }
      finish()
      return
    }

    // 靠近需偏移穿过的门（开着或刚打开）：look + forward + 侧移
    if (t.action && !state.waitingOpen && horiz <= 0.9) {
      const yaw = bot.entity.yaw
      state.passSide = pickPassSide(p, yaw)
      state.passUntil = now + PASS_MS
      state.mode = 'doorpass'
    }

    const yaw = bot.entity.yaw
    const tyaw = targetYaw(p)

    // 运动
    clearControls()
    bot.look(tyaw, 0, true)
    bot.setControlState('forward', true)
    if (state.mode === 'doorpass' && now < state.passUntil) {
      bot.setControlState(state.passSide, true)
    } else {
      state.mode = 'straight'
    }
    const inWater = bot.entity.isInWater
    const diffUp = tw.diff != null && tw.diff > 0.5
    const jump = inWater || diffUp || now < state.jumpUntil
    bot.setControlState('jump', jump)

    // 卡住检测
    if (state.stuckPos && now - state.stuckSince > STUCK_MS) {
      const moved = Math.hypot(p.x - state.stuckPos.x, p.z - state.stuckPos.z)
      if (moved < STUCK_DIST) {
        if (state.mode === 'doorpass') {
          // 穿门被堵：换侧；再卡 → 重算
          state.passSide = state.passSide === 'left' ? 'right' : 'left'
          state.stuckSince = now
        } else if (state.jumpTries < MAX_JUMP_TRIES) {
          state.jumpUntil = now + JUMP_SPOT_MS
          state.jumpTries++
        } else {
          if (!replan(false)) {
            pathStatus('noPath')
            fail()
          }
          return
        }
      }
    }
    state.stuckPos = { x: p.x, z: p.z }
    state.stuckSince = now
  }

  function start() {
    state.running = true
    if (!timer) timer = setInterval(tick, TICK_MS)
  }

  function goto(x, y, z) {
    if (!bot || !bot.entity) return false
    const gx = Math.floor(x)
    const gy = Math.floor(y)
    const gz = Math.floor(z)
    // 完整重置，避免上一次移动的残留状态（等开门/穿门/避障）与本次目标互搏
    clearControls()
    state.goal = { x: gx, y: gy, z: gz }
    state.target = null
    state.queue = []
    state.opened = new Set()
    state.openUntil = 0
    state.startedAt = Date.now()
    state.jumpTries = 0
    state.jumpUntil = 0
    state.stuckSince = 0
    state.stuckPos = null
    state.mode = 'straight'
    state.waitingOpen = null
    state.passSide = 'left'
    state.passUntil = 0
    state.replanAt = 0
    state.lastStatus = null
    start()
    emit('move_started', { x: gx, y: gy, z: gz })
    pathStatus('computing')
    if (!replan(true)) {
      pathStatus('noPath')
      fail()
      return true
    }
    pathStatus('moving')
    return true
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    state.target = null
    state.goal = null
    state.queue = []
    state.waitingOpen = null
    state.mode = 'straight'
    state.passSide = 'left'
    state.passUntil = 0
    state.running = false
    clearControls()
  }

  function isMoving() {
    return state.target !== null
  }

  function destroy() {
    stop()
  }

  return { goto, stop, isMoving, destroy }
}
