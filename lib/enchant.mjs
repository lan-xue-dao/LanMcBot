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
