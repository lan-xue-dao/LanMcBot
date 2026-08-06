// lib/nav/controller.mjs
// 直线执行器：直线优先 → 被挡转最小偏差绕行 → 橡皮筋平滑后沿路点行走。
//   行走：面向路点 + forward；台阶/矮墙用「碰撞触发式点跳」（水平距离不降就点跳，无物理模拟）；
//   水内持续跳跃（游泳上浮）；卡住（3s 无进展）→ 原地重规划（失败递增退避后上报 path_failed）；
//   超长直线被截断时，走完截断段后从当前位置续算（增量推进，路线边走边优化）。

import { checkLine } from './line.mjs'
import { findDetour } from './detour.mjs'
import { smoothPath } from './smooth.mjs'
import { createWorldFromBot } from './world.mjs'
import vec3 from 'vec3'

const TICK_MS = 100
const STUCK_MS = 3000
const STUCK_DIST = 0.3
const MAX_RETRIES = 4
const JUMP_NO_PROGRESS_MS = 350
const JUMP_PRESS_MS = 250
const STEP_JUMP_MS = 450
const OPEN_DIST = 4

export function createController(bot, onEvent) {
  const world = createWorldFromBot(bot)
  const state = {
    target: null,        // {x,y,z}
    waypoints: [],       // [{x,y,z,cellKey}]
    openMap: new Map(),  // cellKey -> {x,y,z} 需要开门的格
    opened: new Set(),
    endIsTarget: false,
    retries: 0,
    retryAfter: 0,
    stuckSince: 0,
    stuckPos: null,
    lastProg: { t: 0, d: 0 },
    jumpUntil: 0,
    openUntil: 0,
    lastStatus: null,
    running: false
  }
  let timer = null

  function emit(ev, data) {
    if (onEvent) onEvent(ev, data)
  }

  function clearControls() {
    if (!bot) return
    bot.setControlState('forward', false)
    bot.setControlState('back', false)
    bot.setControlState('left', false)
    bot.setControlState('right', false)
    bot.setControlState('jump', false)
    bot.setControlState('sprint', false)
    bot.setControlState('sneak', false)
  }

  function pathStatus(status) {
    if (status !== state.lastStatus) {
      state.lastStatus = status
      emit('path_update', { status })
    }
  }

  function fail() {
    emit('path_failed', { status: 'noPath' })
    state.target = null
    state.waypoints = []
    clearControls()
  }

  function start() {
    state.running = true
    if (!timer) timer = setInterval(tick, TICK_MS)
  }

  function tick() {
    if (!bot || !bot.entity) return
    const now = Date.now()
    const p = bot.entity.position
    if (!state.target) return

    if (state.waypoints.length === 0) {
      if (state.endIsTarget) {
        finish()
      } else if (now >= state.retryAfter) {
        plan(p, false, now)
      }
      return
    }
    follow(p, now)
  }

  function finish() {
    const t = state.target
    state.target = null
    state.waypoints = []
    state.openMap = new Map()
    clearControls()
    emit('goal_reached', { x: t.x, y: t.y, z: t.z })
  }

  function plan(p, fromStuck, now = Date.now()) {
    world.clearCache()
    const sx = Math.floor(p.x)
    const sy = Math.floor(p.y)
    const sz = Math.floor(p.z)
    const target = state.target
    pathStatus('computing')

    let line
    try {
      line = checkLine(world, sx, sy, sz, target.x, target.z)
    } catch (e) {
      line = null
    }
    let path = null
    if (line && line.ok) {
      path = line.path
      state.endIsTarget = !line.truncated
    } else {
      const res = findDetour(world, { x: sx, z: sz, feetY: sy }, { x: target.x, z: target.z }, { sx, sz })
      if (res.status !== 'found') {
        state.retries++
        if (state.retries >= MAX_RETRIES) {
          pathStatus('noPath')
          fail()
          return
        }
        pathStatus('noPath')
        state.retryAfter = now + 800 * state.retries
        return
      }
      path = res.path
      state.endIsTarget = true
      state.openMap = new Map(res.opens.map(o => [`${o.x},${o.y},${o.z}`, o]))
    }

    path = smoothPath(world, path)
    state.waypoints = path.map(w => ({
      x: w.x + 0.5,
      y: w.feetY,
      z: w.z + 0.5,
      cellKey: `${Math.floor(w.x)},${Math.floor(w.feetY)},${Math.floor(w.z)}`
    }))
    state.retries = 0
    state.stuckSince = 0
    state.stuckPos = null
    pathStatus(fromStuck ? 'replanned' : 'moving')
    if (bot) bot.setControlState('forward', true)
  }

  function handleOpen(wp, p, now) {
    const openAt = state.openMap.get(wp.cellKey)
    if (!openAt) return
    const key = `${openAt.x},${openAt.y},${openAt.z}`
    if (state.opened.has(key)) return
    if (now < state.openUntil) return
    const d = Math.hypot(openAt.x + 0.5 - p.x, openAt.y + 0.5 - p.y, openAt.z + 0.5 - p.z)
    if (d > OPEN_DIST) return
    const block = bot.blockAt(vec3(openAt.x, openAt.y, openAt.z))
    if (block) {
      try {
        bot.activateBlock(block)
      } catch {}
    }
    state.opened.add(key)
    state.openUntil = now + 900
  }

  function follow(p, now) {
    let wp = state.waypoints[0]
    let dx = wp.x - p.x
    let dy = wp.y - p.y
    let dz = wp.z - p.z
    let horiz = Math.hypot(dx, dz)

    if (horiz <= 0.35 && Math.abs(dy) < 1.2) {
      state.waypoints.shift()
      state.stuckSince = 0
      if (state.waypoints.length === 0) return
      wp = state.waypoints[0]
      dx = wp.x - p.x
      dy = wp.y - p.y
      dz = wp.z - p.z
      horiz = Math.hypot(dx, dz)
    }

    handleOpen(wp, p, now)

    bot.look(Math.atan2(-dx, -dz), 0)
    bot.setControlState('forward', true)

    // 跳跃策略
    const inWater = bot.entity.isInWater
    const needUp = dy > 0.4
    if (inWater) {
      bot.setControlState('jump', true)
    } else if (now < state.jumpUntil) {
      bot.setControlState('jump', true)
    } else {
      bot.setControlState('jump', false)
      // 碰撞触发点跳：水平距离不降（撞墙/台阶）且在地面
      if (now - state.lastProg.t > JUMP_NO_PROGRESS_MS && bot.entity.onGround && horiz > 0.4) {
        state.jumpUntil = now + JUMP_PRESS_MS
        bot.setControlState('jump', true)
      }
      // 上台阶：靠近且路点更高
      if (needUp && horiz < 1.3) {
        state.jumpUntil = now + STEP_JUMP_MS
        bot.setControlState('jump', true)
      }
    }

    // 卡住检测（3s 无位移 → 重规划）
    if (state.stuckPos && now - state.stuckSince > STUCK_MS) {
      const moved = Math.hypot(p.x - state.stuckPos.x, p.z - state.stuckPos.z)
      if (moved < STUCK_DIST) {
        state.waypoints = []
        plan(p, true, now)
        return
      }
    }
    state.stuckPos = { x: p.x, z: p.z }
    state.stuckSince = now

    // 进度追踪（水平距离相对上一采样是否下降）
    const nd = Math.hypot(wp.x - p.x, wp.z - p.z)
    if (nd < state.lastProg.d - 0.05) {
      state.lastProg = { t: now, d: nd }
    } else if (now - state.lastProg.t > 600) {
      state.lastProg = { t: now, d: nd }
    }
  }

  function goto(x, y, z) {
    if (!bot || !bot.entity) return false
    const tx = Math.floor(x)
    const ty = Math.floor(y)
    const tz = Math.floor(z)
    state.target = { x: tx, y: ty, z: tz }
    state.waypoints = []
    state.openMap = new Map()
    state.opened = new Set()
    state.retries = 0
    state.retryAfter = 0
    state.endIsTarget = false
    state.lastStatus = null
    start()
    emit('move_started', { x: tx, y: ty, z: tz })
    plan(bot.entity.position, false)
    return true
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    state.target = null
    state.waypoints = []
    state.openMap = new Map()
    state.running = false
    clearControls()
  }

  function isMoving() {
    return state.target !== null && state.waypoints.length > 0
  }

  function destroy() {
    stop()
  }

  return { goto, stop, isMoving, destroy }
}
