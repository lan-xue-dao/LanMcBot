// lib/nav/index.mjs
// 自研避障移动引擎统一出口：initNav(bot, onEvent) → { goto, stop, isMoving, destroy }
// 事件（与旧 pathfinder 兼容）：move_started / path_update{status} / path_failed{status} / goal_reached

import { createController } from './controller.mjs'

export function initNav(bot, onEvent) {
  const controller = createController(bot, onEvent)
  return {
    goto: (x, y, z) => controller.goto(x, y, z),
    stop: () => controller.stop(),
    isMoving: () => controller.isMoving(),
    destroy: () => controller.destroy()
  }
}

// 供进程内测试：用假 bot.world（blockAt）构造独立世界
export { checkLine } from './line.mjs'
export { findDetour, searchOnce } from './detour.mjs'
export { smoothPath } from './smooth.mjs'
export { createWorld, groundAt, bodyClearAt, blockInfo } from './world.mjs'