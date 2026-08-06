// lib/nav/controller.mjs
// 反应式移动控制器：直线朝目标前进，实时扫描前方障碍并反应。
//   前方 1-3 格净空（地面可达 ± 身体可穿过）→ 继续直行
//   门 → 右键开门；1 高台阶/水 → 跳；墙/悬崖/深坑 → 侧向绕行（目标所在侧优先）
//   绕行中前方重新净空 → 回直行；卡住 3s 无位移 → 换侧，两侧都试过 → path_failed
// 楼梯/浅坑天然可走：前方格高度差在 [-maxDrop, +1.2] 内即可通过（走/落/跳）。

import { createWorldFromBot, groundAt, bodyClearAt } from './world.mjs'
import vec3 from 'vec3'

const TICK_MS = 100
const STUCK_MS = 3000
const STUCK_DIST = 0.3
const MAX_JUMP_UP = 1.2
const MAX_DROP = 4
const OPEN_CD = 900
const SCAN_DIST = 3
const DETOUR_SWITCH_MS = 3000

export function createController(bot, onEvent) {
  const world = createWorldFromBot(bot)
  const state = {
    target: null,
    detouring: false,
    detourDir: 0,
    detourSince: 0,
    triedSides: 0,
    opened: new Set(),
    openUntil: 0,
    jumpUntil: 0,
    stuckTries: 0,
    stuckSince: 0,
    stuckPos: null,
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
    emit('path_failed', { status: 'noPath' })
    state.target = null
    state.detouring = false
    clearControls()
  }

  function finish() {
    const t = state.target
    state.target = null
    state.detouring = false
    clearControls()
    emit('goal_reached', { x: t.x, y: t.y, z: t.z })
  }

  // 沿指定 yaw 方向扫描前方 SCAN_DIST 格
  // 返回 { obstacle: {type,x,y,z} | null, diff1: 前方第 1 格高度差 | null }
  //   door: 需开门的格（openable 且未开）；wall: 高墙/不可穿；cliff: 深渊/过深
  // 悬空（脚下无地面，如正站在坑口上方）时不判障碍，交给重力掉落
  function scanAhead(p, feet, yaw) {
    const under = world.getCell(Math.floor(p.x), Math.floor(feet) - 1, Math.floor(p.z))
    if (!under.standable) return { obstacle: null, diff1: null }
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    let diff1 = null
    for (let k = 1; k <= SCAN_DIST; k++) {
      const gx = Math.floor(p.x + fx * k)
      const gz = Math.floor(p.z + fz * k)
      const ground = groundAt(world, gx, gz, feet + 3, feet - MAX_DROP)
      if (!ground) return { obstacle: { type: 'cliff', x: gx, z: gz }, diff1 }
      const diff = ground.feetY - feet
      if (diff > MAX_JUMP_UP) return { obstacle: { type: 'wall', x: gx, z: gz }, diff1 }
      if (diff < -MAX_DROP) return { obstacle: { type: 'cliff', x: gx, z: gz }, diff1 }
      if (!bodyClearAt(world, gx, ground.feetY, gz, diff > 0.5)) {
        const c = world.getCell(gx, ground.feetY, gz)
        return { obstacle: { type: c.needsOpen ? 'door' : 'wall', x: gx, y: ground.feetY, z: gz }, diff1 }
      }
      if (k === 1) diff1 = diff
    }
    return { obstacle: null, diff1 }
  }

  function tryOpen(ob, now) {
    if (now < state.openUntil) return
    const key = `${ob.x},${ob.y},${ob.z}`
    if (state.opened.has(key)) return
    try {
      const block = bot.blockAt(vec3(ob.x, ob.y, ob.z))
      if (block) bot.activateBlock(block)
    } catch {}
    state.opened.add(key)
    state.openUntil = now + OPEN_CD
  }

  function targetYaw(p) {
    const t = state.target
    return Math.atan2(-(t.x + 0.5 - p.x), -(t.z + 0.5 - p.z))
  }

  function startDetour(p) {
    let delta = targetYaw(p) - bot.entity.yaw
    while (delta > Math.PI) delta -= 2 * Math.PI
    while (delta < -Math.PI) delta += 2 * Math.PI
    state.detouring = true
    state.detourDir = delta >= 0 ? 1 : -1
    state.detourSince = Date.now()
    state.triedSides = 0
    state.stuckSince = 0
    state.stuckPos = null
  }

  function tick() {
    if (!bot || !bot.entity || !state.target) return
    const now = Date.now()
    const p = bot.entity.position
    const t = state.target
    const feet = p.y

    // 到达：xz 到格心 0.6 内，且 y 与目标差 ≤1.2（楼梯/坑靠自然走动/掉落收敛）
    const horiz = Math.hypot(t.x + 0.5 - p.x, t.z + 0.5 - p.z)
    if (horiz <= 0.6 && Math.abs(feet - t.y) <= 1.2) {
      finish()
      return
    }

    const yaw = bot.entity.yaw
    const tyaw = targetYaw(p)
    const scan = scanAhead(p, feet, state.detouring ? tyaw : yaw)
    const ob = scan.obstacle

    if (ob && ob.type === 'door') {
      tryOpen(ob, now)
    } else if (ob && !state.detouring) {
      startDetour(p)
    } else if (!ob && state.detouring) {
      // 目标方向重新净空 → 回直行
      state.detouring = false
      state.detourSince = 0
      state.stuckSince = 0
      state.stuckPos = null
    }

    // 绕行中：目标方向持续不通（3s）→ 换侧，防止绕圈死循环
    if (state.detouring && ob && now - state.detourSince > DETOUR_SWITCH_MS) {
      state.detourDir = -state.detourDir
      state.detourSince = now
      state.triedSides++
      if (state.triedSides >= 2) {
        pathStatus('noPath')
        fail()
        return
      }
    }

    // 运动
    if (state.detouring) {
      bot.look(yaw + state.detourDir * Math.PI / 2, 0)
    } else {
      bot.look(tyaw, 0)
    }
    bot.setControlState('forward', true)

    const inWater = bot.entity.isInWater
    const jump = inWater || (scan.diff1 != null && scan.diff1 > 0.5) || now < state.jumpUntil
    bot.setControlState('jump', jump)

    // 卡住检测
    if (state.stuckPos && now - state.stuckSince > STUCK_MS) {
      const moved = Math.hypot(p.x - state.stuckPos.x, p.z - state.stuckPos.z)
      if (moved < STUCK_DIST) {
        if (state.detouring) {
          // 绕行被堵死：换侧
          state.detourDir = -state.detourDir
          state.triedSides++
          if (state.triedSides >= 2) {
            pathStatus('noPath')
            fail()
            return
          }
        } else {
          // 直行无障却卡住：可能是矮障碍/碰撞点，跳一下；3 次仍卡 → 失败
          state.jumpUntil = now + 400
          state.stuckTries++
          if (state.stuckTries >= 3) {
            pathStatus('noPath')
            fail()
            return
          }
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
    const tx = Math.floor(x)
    const ty = Math.floor(y)
    const tz = Math.floor(z)
    state.target = { x: tx, y: ty, z: tz }
    state.detouring = false
    state.opened = new Set()
    state.stuckTries = 0
    state.stuckSince = 0
    state.stuckPos = null
    state.lastStatus = null
    start()
    emit('move_started', { x: tx, y: ty, z: tz })
    pathStatus('computing')
    pathStatus('moving')
    return true
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    state.target = null
    state.detouring = false
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
