// 容器（箱子/木桶）物品存取（P1 背包管理增强）：
//   决策/规划纯函数（槽位规划：先存什么、放哪格）+ 运行期 openChest/deposit/withdraw。

/**
 * 纯函数：规划把哪些背包物品存进箱子。
 * @param {Array<{name:string, count:number, slot:number}>} inventory 背包（不含热栏可自行过滤）
 * @param {{keep?:Set<string>, depositAll?:boolean}} o
 *   keep: 保留物品名集合（武器/食物/工具）；depositAll=true 忽略 keep 全存
 * @returns {Array<{name:string, count:number}>} 待存清单（按数量降序）
 */
export function planDeposit(inventory, { keep = new Set(), depositAll = false } = {}) {
  const out = []
  for (const it of inventory || []) {
    if (!it || !it.name) continue
    if (!depositAll && keep.has(it.name)) continue
    out.push({ name: it.name, count: it.count || 1 })
  }
  out.sort((a, b) => b.count - a.count)
  return out
}

/**
 * 纯函数：规划从箱子取什么。
 * @param {Array<{name:string, count:number}>} chestItems 箱内物品
 * @param {string} itemName 目标物品（归一化比较）
 * @param {number} count 目标数量
 * @returns {{name:string, count:number}|null} 实际可取数量（箱内不足则取全部）
 */
export function planWithdraw(chestItems, itemName, count = 1) {
  const n = String(itemName || '').toLowerCase().replace(/[-_\s]+/g, '')
  let available = 0
  for (const it of chestItems || []) {
    if (it && String(it.name).toLowerCase().replace(/[-_\s]+/g, '') === n) available += it.count || 0
  }
  if (available === 0) return null
  return { name: itemName, count: Math.min(count, available) }
}

/**
 * 纯函数：从物品列表里找最近的容器方块。
 * @param {Array<{name:string, position:{x,y,z,distanceTo}}>} blocks
 * @param {object} botPos
 * @param {number} maxDistance
 * @returns {{block:object, distance:number}|null}
 */
export function pickNearestContainer(blocks, botPos, maxDistance = 16) {
  const CONTAINERS = new Set(['chest', 'trapped_chest', 'barrel'])
  let best = null
  let bestD = Infinity
  for (const b of blocks || []) {
    if (!b || !b.name || !b.position) continue
    if (!CONTAINERS.has(b.name)) continue
    const d = b.position.distanceTo(botPos)
    if (d < bestD && d <= maxDistance) {
      bestD = d
      best = b
    }
  }
  return best ? { block: best, distance: bestD } : null
}

/**
 * 容器存取编排工厂（假 bot 可测）：把「找箱→开箱→逐格存/取→关箱」抽成注入式结构。
 * 关键防御（都是箱子最常见的坑）：
 *   - 开箱超时：openChest 用 withTimeout 收敛，不会永久 await
 *   - 箱子满：单格 deposit 抛错即停该物品，其余继续，最终 ok:false 但不崩
 *   - 关箱必执行：finally 里 close，避免窗口悬挂堵住后续所有操作
 *   - 合并语义：交给 mineflayer 的 deposit/withdraw（同物品自动并堆），本层只按数量累加
 *
 * @param {object} deps
 * @param {()=>(object|null)} deps.getBot
 * @param {()=>(object|null)} deps.findContainer 最近容器方块
 * @param {(block:object)=>Promise<object>} deps.openContainer → {items(), deposit(type,meta,n), withdraw(type,meta,n), close()}
 * @param {()=>Array} deps.items 背包物品
 * @param {(name:string)=>(string|null)} deps.zhIdOf
 * @param {(type:string,payload?:any)=>void} [deps.onMessage]
 * @param {number} [deps.openTimeoutMs] 开箱超时（默认 5000）
 */
export function createContainerOps (deps) {
  const { getBot, findContainer, openContainer, items, zhIdOf, onMessage, openTimeoutMs = 5000 } = deps

  function withTimeout (promise, ms, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
      promise.then(
        v => { clearTimeout(timer); resolve(v) },
        e => { clearTimeout(timer); reject(e) }
      )
    })
  }

  async function openChestSafely (block) {
    try {
      return { chest: await withTimeout(openContainer(block), openTimeoutMs, '打开容器') }
    } catch (err) {
      return { error: `打开容器失败: ${err.message || err}` }
    }
  }

  async function deposit (keepNames = []) {
    const bot = getBot ? getBot() : null
    if (!bot || !bot.entity) return { ok: false, reason: '未连接' }
    if (!(items() || []).length) return { ok: false, reason: '背包是空的' }

    const block = findContainer()
    if (!block) return { ok: false, reason: '附近 16 格内没有箱子/木桶' }

    const plan = planDeposit(
      (items() || []).map(i => ({ name: i.name, count: i.count, slot: i.slot })),
      { keep: new Set(keepNames || []) }
    )
    if (plan.length === 0) return { ok: false, reason: '没有可存的物品（全部在保留名单里）' }

    const { chest, error } = await openChestSafely(block)
    if (error) return { ok: false, reason: error }

    const depositedList = []
    try {
      for (const entry of plan) {
        let remain = entry.count
        // 每次重取背包：存一格后数量在变（不能对旧快照反复累加）
        for (const slotItem of (items() || []).filter(i => i.name === entry.name)) {
          if (remain <= 0) break
          const n = Math.min(remain, slotItem.count)
          if (n <= 0) continue
          try {
            await chest.deposit(slotItem.type, slotItem.metadata, n)
            remain -= n
          } catch {
            break // 单格失败（箱子满）：停该物品，继续下一个
          }
        }
        const moved = entry.count - Math.max(remain, 0)
        if (moved > 0) depositedList.push({ name: entry.name, count: moved })
      }
    } finally {
      try { chest.close() } catch { /* 已关则忽略 */ }
    }

    if (depositedList.length === 0) return { ok: false, reason: '存入失败（箱子可能已满）' }
    if (onMessage) onMessage('chest_deposit', { items: depositedList })
    return { ok: true, deposited: depositedList }
  }

  async function withdraw (itemName, count = 1) {
    const bot = getBot ? getBot() : null
    if (!bot || !bot.entity) return { ok: false, reason: '未连接' }
    const want = Math.max(1, parseInt(count, 10) || 1)

    const block = findContainer()
    if (!block) return { ok: false, reason: '附近 16 格内没有箱子/木桶' }

    const { chest, error } = await openChestSafely(block)
    if (error) return { ok: false, reason: error }

    try {
      const plan = planWithdraw((chest.items() || []).map(i => ({ name: i.name, count: i.count })), itemName, want)
      if (!plan) return { ok: false, reason: `箱子里没有 ${itemName}` }

      const zhId = zhIdOf(itemName)
      const targets = new Set([plan.name, itemName, zhId].filter(Boolean).map(s => String(s).toLowerCase()))
      let remain = plan.count
      for (const slotItem of (chest.items() || []).filter(i => targets.has(String(i.name).toLowerCase()))) {
        if (remain <= 0) break
        const n = Math.min(remain, slotItem.count)
        if (n <= 0) continue
        try {
          await chest.withdraw(slotItem.type, slotItem.metadata, n)
          remain -= n
        } catch {
          break // 单格失败（背包满）：停该物品
        }
      }

      const got = plan.count - Math.max(remain, 0)
      if (got <= 0) return { ok: false, reason: `取出失败: ${itemName}` }
      if (got < plan.count && onMessage) onMessage('chest_withdraw_partial', { name: itemName, want: plan.count, got })
      if (onMessage) onMessage('chest_withdraw', { name: itemName, count: got })
      return { ok: true, name: itemName, count: got }
    } finally {
      try { chest.close() } catch { /* 已关则忽略 */ }
    }
  }

  return { deposit, withdraw }
}