/*
耕种/收获能力域（对标 MCC 自动农场）：成熟判定与补种映射为纯函数，收获编排为依赖注入工厂
createHarvester（零全局、可用假 bot 测）；运行期扫描→走近→dig→补种循环由 bot.mjs 注入 mineflayer 组装。

调用示例：
  import { CROPS, isRipe, selectRipeCrops, replantSeed, createHarvester } from './lib/farming.mjs'

  isRipe('wheat', 7)                    // → true（wheat 成熟档 7）
  selectRipeCrops(blocks)               // 从候选（{name, age}）筛成熟项
  replantSeed('wheat')                  // → 'wheat_seeds'；浆果丛 → null 不补种

  // 编排（bot.mjs 已包装为 harvestCrops；测试用假 bot/世界注入）：
  const harvest = createHarvester({ getBot, findBlocks, blockAt, dig, hasItem, placeBlock,
                                    withinReach, approachAndWait, sleep, now, onMessage })
  const r = await harvest({ radius: 24, max: Infinity, replant: true })
                                        // → { ok, harvested, replanted }

作物数据基于 minecraft-data 1.20.4：block state `age`。
  ripeAge = 视为成熟可收的最低 age；replant = 收获后原地补种的种子物品名（null 表示无需/不可补种）。
*/

// 作物方块名 → 收获参数
export const CROPS = {
  wheat:          { ripeAge: 7, replant: 'wheat_seeds',    produce: 'wheat' },
  carrots:        { ripeAge: 7, replant: 'carrot',         produce: 'carrot' },
  potatoes:       { ripeAge: 7, replant: 'potato',         produce: 'potato' },
  beetroots:      { ripeAge: 7, replant: 'beetroot_seeds', produce: 'beetroot' },
  cocoa:          { ripeAge: 2, replant: 'cocoa_beans',    produce: 'cocoa_beans' },
  nether_wart:    { ripeAge: 3, replant: 'nether_wart',    produce: 'nether_wart' },
  sweet_berry_bush: { ripeAge: 2, replant: null,           produce: 'sweet_berries' }
}

/**
 * 纯函数：取作物收获参数（非作物返回 null）。大小写不敏感。
 */
export function getCropInfo(name) {
  if (!name) return null
  const n = String(name).trim().toLowerCase()
  return CROPS[n] || null
}

/**
 * 纯函数：某作物在给定 age 下是否成熟可收。非作物 / age 缺失返回 false。
 */
export function isRipe(name, age) {
  const info = getCropInfo(name)
  if (!info) return false
  return typeof age === 'number' && age >= info.ripeAge
}

/**
 * 纯函数：从候选作物（含 name + age）里筛出成熟项。
 * @param {Array<{name:string, age:number}>} blocks
 * @returns {Array<object>} 原对象引用，成熟且属于已知作物
 */
export function selectRipeCrops(blocks) {
  return (blocks || []).filter(b => b && isRipe(b.name, b.age))
}

/**
 * 纯函数：该作物收获后应补种的种子名（无则 null）。
 */
export function replantSeed(name) {
  const info = getCropInfo(name)
  return info ? info.replant : null
}

/**
 * 收获编排工厂：把「扫描成熟 → 走近 → 挖 → 补种」循环的状态机抽成依赖注入的纯函数，
 * 便于用假 bot 做运行期测试（此前编排硬绑模块级单例，零覆盖、findBlocks/age 读取等易错点测不到）。
 * 所有外部交互经 deps 注入，本工厂自身不引用任何全局。行为与 bot.mjs 原 harvestCrops 一致。
 *
 * @param {object} deps
 * @param {()=>(object|null)} deps.getBot 取 bot（无 bot 报未连接）
 * @param {(opts:{matching:Function,maxDistance:number,count:number})=>Array} deps.findBlocks 收 Block 判 name、返回方块数组
 * @param {(pos:object)=>(object|null)} deps.blockAt 位置 → 方块（含 _properties.age）
 * @param {(block:object)=>Promise} deps.dig 挖掘
 * @param {(name:string)=>boolean} deps.hasItem 背包是否含某物（查种子）
 * @param {(name:string,x,y,z)=>Promise} deps.placeBlock 补种
 * @param {(pos:object)=>boolean} deps.withinReach 是否在触及距离内
 * @param {(pos:object)=>Promise} deps.approachAndWait 走近并等待到达
 * @param {(ms:number)=>Promise} deps.sleep 退避
 * @param {()=>number} [deps.now] 时间源（默认 Date.now，测试可注入固定值）
 * @param {(type:string,payload?:any)=>void} [deps.onMessage] 事件回调
 * @param {number} [deps.timeoutMs] 总超时
 * @returns {(opts?:{radius?:number,max?:number,replant?:boolean})=>Promise<{ok:boolean,harvested:number,replanted:number,reason?:string}>}
 */
export function createHarvester (deps) {
  const {
    getBot, findBlocks, blockAt, dig, hasItem, placeBlock,
    withinReach, approachAndWait, sleep,
    now = Date.now, onMessage, timeoutMs = 60000
  } = deps
  const cropNames = new Set(Object.keys(CROPS))

  return async function harvest ({ radius = 24, max = Infinity, replant = true } = {}) {
    const bot = getBot ? getBot() : null
    if (!bot || !bot.entity) return { ok: false, harvested: 0, replanted: 0, reason: '未连接' }

    let harvested = 0
    let replanted = 0
    const startTime = now()

    while (harvested < max && now() - startTime < timeoutMs) {
      let found = []
      try {
        found = findBlocks({ matching: b => b && cropNames.has(b.name), maxDistance: radius, count: 64 }) || []
      } catch (e) {
        return { ok: harvested > 0, harvested, replanted, reason: `扫描失败: ${e.message}` }
      }
      const cands = found.map(p => {
        const blk = blockAt(p)
        return blk ? { name: blk.name, age: blk._properties && blk._properties.age, position: p, block: blk } : null
      }).filter(Boolean)
      const ripe = selectRipeCrops(cands)
      if (ripe.length === 0) break // 无成熟作物，收工

      const target = ripe[0]
      const pos = target.position
      if (!withinReach(pos)) {
        await approachAndWait(pos)
        continue
      }
      try {
        await dig(target.block)
        harvested++
        if (onMessage) onMessage('crop_harvested', { name: target.name, total: harvested })
        if (replant) {
          const seed = replantSeed(target.name)
          if (seed && hasItem(seed)) {
            try { await placeBlock(seed, pos.x, pos.y, pos.z); replanted++ } catch { /* 无位/失败跳过 */ }
          }
        }
      } catch {
        await sleep(300) // 单次失败小退避后重扫
      }
    }
    return { ok: true, harvested, replanted }
  }
}
