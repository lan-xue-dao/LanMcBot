/*
附魔能力域（对标 MCC 附魔台）：选项格式化/择优选单为纯函数（零 bot 依赖，可单测），
运行期开台/放料/附魔/取回由 bot.mjs 调 mineflayer enchantment_table API。

调用示例：
  import { formatEnchantOptions, enchantOptionsReady, pickEnchantOption } from './lib/enchant.mjs'

  const ready = enchantOptionsReady(table.enchantments)     // 三档 level>=0 才 true（替代 'ready' 事件，防挂起）
  const opts = formatEnchantOptions(table.enchantments)     // [{choice, xpLevel, predicted}]
  const pick = pickEnchantOption(table.enchantments, { botLevel: bot.experience.level, prefer: 'best' })
  if (pick) await table.enchant(pick.choice)                // choice 0..2；xpLevel = 该档所需经验

mineflayer enchantments 数组（3 项）每项：{ level, expected: { enchant, level } }
  level = 所需经验等级（服务器未就绪/无青金石时为 -1）；
  expected.enchant/level = 预测附魔（依赖 xpseed，离线服务器可能为 -1，仅作展示）。
关键：无青金石/经验不足时 mineflayer 永不发 'ready'，await once('ready') 会永久挂起——
运行期必须用 enchantOptionsReady 轮询超时（bot.mjs 的 enchantItem 已这样做）。
*/

/**
 * 纯函数：归一化 3 个附魔选项。
 * @param {Array<{level:number, expected?:{enchant:number, level:number}}>} enchantments
 * @returns {Array<{choice:number, xpLevel:number, predicted:{enchant:number,level:number}|null}>}
 */
export function formatEnchantOptions(enchantments) {
  return (enchantments || []).map((e, choice) => {
    const xp = e && typeof e.level === 'number' ? e.level : -1
    const pred = e?.expected && e.expected.enchant >= 0 && e.expected.level >= 0
      ? { enchant: e.expected.enchant, level: e.expected.level }
      : null
    return { choice, xpLevel: xp, predicted: pred }
  })
}

/**
 * 纯函数：是否所有选项都已就绪（等价于 mineflayer 的 'ready' 条件：三者 level >= 0）。
 * 运行期以此轮询代替 await once('ready')，避免无青金石/书架时永久挂起。
 */
export function enchantOptionsReady(enchantments) {
  const opts = formatEnchantOptions(enchantments)
  return opts.length === 3 && opts.every(o => o.xpLevel >= 0)
}

/**
 * 纯函数：在就绪且经验付得起的选项中挑选。
 * @param {Array} enchantments mineflayer enchantments
 * @param {{botLevel:number, prefer?:'best'|'cheap'}} o
 *   prefer 'best'（默认）= xpLevel 最高（附魔质量最好/耗经验最多档），'cheap' = 最低档省经验
 * @returns {{choice:number, xpLevel:number}|null}
 */
export function pickEnchantOption(enchantments, { botLevel = 0, prefer = 'best' } = {}) {
  const usable = formatEnchantOptions(enchantments).filter(o => o.xpLevel >= 0 && o.xpLevel <= botLevel)
  if (usable.length === 0) return null
  usable.sort((a, b) => prefer === 'cheap' ? a.xpLevel - b.xpLevel : b.xpLevel - a.xpLevel)
  return { choice: usable[0].choice, xpLevel: usable[0].xpLevel }
}

/**
 * 附魔编排工厂（假 bot 可测）：把「走近台子→开台→放料→等就绪→选档→附魔→取回」抽成注入式结构。
 * 覆盖四类挂起来源：开台超时/槽位未就绪/经验不足/中途窗口被关——全部有超时或错误收敛，不会永久 await。
 *
 * @param {object} deps
 * @param {()=>(object|null)} deps.getBot
 * @param {(pos:object)=>Promise<boolean>} deps.approachAndWait 走近（false = 到不了）
 * @param {(block:object)=>Promise<object>} deps.openTable → 台子对象
 * @param {()=>(object|null)} deps.findTableBlock 最近附魔台方块
 * @param {(name:string)=>Array} deps.items 背包物品
 * @param {(name:string)=>(string|null)} deps.zhIdOf
 * @param {(ms:number)=>Promise} deps.sleep
 * @param {()=>number} [deps.now]
 * @param {(type:string,payload?:any)=>void} [deps.onMessage]
 * @param {number} [deps.readyTimeoutMs] 等选项就绪的超时（默认 3000）
 */
export function createEnchanter (deps) {
  const {
    getBot, approachAndWait, openTable, findTableBlock, items, zhIdOf,
    sleep, now = Date.now, onMessage, readyTimeoutMs = 3000
  } = deps

  // 轮询直到三档 level>=0；无青金石/书架/经验时 mineflayer 永不 ready，必须超时收敛
  async function waitReady (table) {
    const deadline = now() + readyTimeoutMs
    while (now() < deadline) {
      if (enchantOptionsReady(table.enchantments)) return true
      await sleep(250)
    }
    return enchantOptionsReady(table.enchantments)
  }

  return async function enchant (itemName, count = 1, { prefer = 'best' } = {}) {
    const bot = getBot ? getBot() : null
    if (!bot || !bot.entity) return { ok: false, enchanted: 0, results: [], reason: '未连接' }
    const want = Math.max(1, parseInt(count, 10) || 1)

    const zhId = zhIdOf(itemName)
    const targets = new Set([itemName, zhId, `minecraft:${itemName}`].filter(Boolean).map(s => String(s).toLowerCase()))
    const norm = n => String(n).toLowerCase()
    const findTarget = () => (items() || []).find(i => targets.has(norm(i.name)))
    if (!findTarget()) return { ok: false, enchanted: 0, results: [], reason: `背包里没有物品: ${itemName}` }

    const tableBlock = findTableBlock()
    if (!tableBlock) return { ok: false, enchanted: 0, results: [], reason: '附近 16 格内没有附魔台' }
    if (!(await approachAndWait(tableBlock))) return { ok: false, enchanted: 0, results: [], reason: '无法走近附魔台' }

    let t
    try {
      t = await openTable(tableBlock)
    } catch (err) {
      return { ok: false, enchanted: 0, results: [], reason: `打开附魔台失败: ${err.message || err}` }
    }

    let enchanted = 0
    const results = []
    try {
      for (let i = 0; i < want; i++) {
        const target = findTarget()
        if (!target) break                                     // 物品用完了
        const lapis = (items() || []).find(x => x.name === 'lapis_lazuli')
        if (!lapis) {
          if (enchanted === 0) return { ok: false, enchanted, results, reason: '没有青金石（lapis_lazuli）' }
          break
        }

        await t.putTargetItem(target)
        await t.putLapis(lapis)

        if (!(await waitReady(t))) {                           // 挂起源头②③：选项始终未就绪
          try { await t.takeTargetItem() } catch { /* 空槽 */ }
          if (enchanted === 0) return { ok: false, enchanted, results, reason: '附魔选项未就绪（可能周围书架/经验不足）' }
          break
        }
        const level = bot.experience ? bot.experience.level : 0
        const pick = pickEnchantOption(t.enchantments, { botLevel: level, prefer })
        if (!pick) {                                           // 挂起源头③：经验不足
          try { await t.takeTargetItem() } catch { /* 空槽 */ }
          if (enchanted === 0) {
            const need = formatEnchantOptions(t.enchantments).filter(o => o.xpLevel >= 0).map(o => o.xpLevel).join('/') || '?'
            return { ok: false, enchanted, results, reason: `经验等级不足（需至少 ${need} 级）` }
          }
          break
        }
        const newItem = await t.enchant(pick.choice)           // 挂起源头④：窗口被关会在这里抛错
        try { await t.takeTargetItem() } catch { /* 附魔后可能已空 */ }
        enchanted++
        results.push({ choice: pick.choice, xpLevel: pick.xpLevel, item: newItem ? newItem.name : null })
        if (onMessage) onMessage('enchanted', { name: itemName, choice: pick.choice, xpLevel: pick.xpLevel, total: enchanted })
      }
      if (enchanted === 0) return { ok: false, enchanted, results, reason: '未能完成任何一次附魔' }
      return { ok: true, enchanted, results }
    } catch (err) {
      return { ok: enchanted > 0, enchanted, results, reason: err.message || '附魔出错' }
    } finally {
      try { t.close() } catch { /* 已关则忽略 */ }
    }
  }
}
