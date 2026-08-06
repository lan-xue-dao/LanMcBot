// lib/nav/smooth.mjs
// 橡皮筋平滑：反复尝试「隔点直线回连」，能直连就删掉中间路点，路线逐步变短变直。
//   直连判定复用 checkLine（含地面可达/身体穿越检查），保证剪枝结果可走。
//   每轮从最远点试起（贪心跳点），多轮迭代直到没有可减点。

import { checkLine } from './line.mjs'

export function smoothPath(world, path, opts = {}) {
  if (!path || path.length <= 2) return path
  const result = path.slice()
  let pass = 0
  const maxPasses = opts.maxPasses ?? 4

  while (pass++ < maxPasses) {
    let improved = false
    for (let i = 0; i < result.length - 2; i++) {
      const a = result[i]
      let bestJ = -1
      for (let j = result.length - 1; j > i + 1; j--) {
        const b = result[j]
        const r = checkLine(world, a.x, a.feetY, a.z, b.x, b.z, opts)
        if (r.ok) {
          bestJ = j
          break
        }
      }
      if (bestJ > i + 1) {
        result.splice(i + 1, bestJ - i - 1)
        improved = true
        i = result.length // 重开本轮
      }
    }
    if (!improved) break
  }
  return result
}