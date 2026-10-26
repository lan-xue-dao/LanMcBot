// 运行时可写路径的单一来源（HOP：数据一个来源）。
//
// 两种运行形态：
//   1) node 直跑（开发）：可写目录 = 仓库根（lib/ 的上一级），与历史行为完全一致；
//   2) pkg 单文件 exe（lanmcbot.exe）：import.meta.url 指向只读的快照虚拟 FS，
//      可写目录 = exe 所在的真实目录（process.pkg 提供 exe 路径）。
//
// 调用示例：
//   import { dataDir } from './paths.mjs'
//   const logFile = path.join(dataDir(), 'bot_2026-01-01.log')
//
// 规则：所有「用户产生的文件」（日志、rules.json、password.enc）一律经 dataDir() 定位，
// 禁止直接用相对路径或 import.meta.url 拼写文件路径。

import path from 'path'
import { fileURLToPath } from 'url'

// 打包形态检测（三态）：
//   pkg exe：process.pkg 存在 → 可写目录 = exe 旁
//   esbuild CJS bundle（喂给 pkg 的中间产物，也可能直接 node 跑）：CJS 输出里 import.meta.url
//     为空串，fileURLToPath('') 抛错 → 捕获后视同"打包形态"，可写目录回退 CWD（CI/冒烟场景）
//   node 直跑（开发）：仓库根，历史行为
const isBundledCjs = (() => {
  try {
    const u = fileURLToPath(import.meta.url)
    return typeof u !== 'string' || u.length === 0
  } catch {
    return true // esbuild CJS 输出里 import.meta.url 为空，fileURLToPath 抛 ERR_INVALID_URL
  }
})()
const isPkg = !!process.pkg || isBundledCjs

export function dataDir () {
  if (isPkg) {
    // pkg exe：快照里 process.pkg.entry 是快照内路径；process.execPath 才是真实 exe 路径。
    // esbuild bundle 直接 node 跑时 execPath 是 node.exe——届时回退 CWD（冒烟/CI 场景）。
    if (process.pkg) return path.dirname(process.execPath)
    return process.cwd()
  }
  // node 直跑：lib/paths.mjs 的上一级就是仓库根（历史行为）
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)))
}

// 供日志命名等场景：判断当前是否单文件形态（影响提示文案）
export function runningAsExe () {
  return isPkg
}
