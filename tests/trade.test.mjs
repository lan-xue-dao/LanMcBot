import { expect } from 'chai'
import { formatTrades, canAfford, pickBestTrade, createTrader } from '../lib/trade.mjs'

// 构造贴合 mineflayer villager.js 字段的假 trade
function mkTrade({ in1 = 'emerald', in1Count = 1, realPrice, in2 = null, in2Count = 1, out = 'wheat', outCount = 6, maxUses = 16, uses = 0 } = {}) {
  const t = {
    inputItem1: { name: in1, type: 1, count: in1Count, metadata: 0 },
    hasItem2: !!in2,
    outputItem: { name: out, type: 1, count: outCount, metadata: 0 },
    maximumNbTradeUses: maxUses,
    nbTradeUses: uses
  }
  if (realPrice != null) t.realPrice = realPrice
  else t.realPrice = in1Count
  if (in2) t.inputItem2 = { name: in2, type: 1, count: in2Count, metadata: 0 }
  return t
}

describe('trade: formatTrades', () => {
  it('归一化单料/双料/售罄', () => {
    const trades = [
      mkTrade({ out: 'diamond', outCount: 1 }),
      mkTrade({ in1: 'emerald', in2: 'wheat', out: 'bread' }),
      mkTrade({ out: 'iron_ingot', uses: 16, maxUses: 16 })
    ]
    const f = formatTrades(trades)
    expect(f[0]).to.deep.include({ index: 0, remaining: 16, soldOut: false })
    expect(f[0].cost1).to.deep.equal({ name: 'emerald', count: 1 })
    expect(f[0].output).to.deep.equal({ name: 'diamond', count: 1 })
    expect(f[1].cost2).to.deep.equal({ name: 'wheat', count: 1 })
    expect(f[2].soldOut).to.equal(true)
    expect(f[2].remaining).to.equal(0)
  })
  it('realPrice 覆盖 inputItem1.count', () => {
    const f = formatTrades([mkTrade({ in1Count: 1, realPrice: 5 })])
    expect(f[0].cost1.count).to.equal(5)
  })
  it('空/缺省安全', () => {
    expect(formatTrades(undefined)).to.deep.equal([])
  })
})

describe('trade: canAfford', () => {
  it('单料买得起', () => {
    const r = canAfford(mkTrade({ realPrice: 3 }), { emerald: 10 }, 2) // 需 6
    expect(r.ok).to.equal(true)
  })
  it('单料不足列出缺口', () => {
    const r = canAfford(mkTrade({ realPrice: 3 }), { emerald: 5 }, 2)
    expect(r.ok).to.equal(false)
    expect(r.missing).to.deep.equal([{ name: 'emerald', need: 6, have: 5 }])
  })
  it('双料任缺其一即不可', () => {
    const t = mkTrade({ realPrice: 1, in2: 'pumpkin', in2Count: 2, out: 'bread' })
    const r = canAfford(t, { emerald: 4, pumpkin: 1 }, 1)
    expect(r.ok).to.equal(false)
    expect(r.missing[0].name).to.equal('pumpkin')
  })
  it('数组背包可用', () => {
    const r = canAfford(mkTrade({ realPrice: 2 }), [{ name: 'emerald', count: 4 }], 2)
    expect(r.ok).to.equal(true)
  })
})

describe('trade: pickBestTrade', () => {
  const inv = { emerald: 20 }
  it('按产物名匹配（大小写不敏感）', () => {
    const trades = [mkTrade({ out: 'wheat' }), mkTrade({ out: 'Diamond' })]
    const pick = pickBestTrade(trades, 'diamond', inv)
    expect(pick.index).to.equal(1)
    expect(pick.formatted.output.name).to.equal('Diamond')
  })
  it('同名多笔挑剩余次数多的', () => {
    const trades = [
      mkTrade({ out: 'bread', maxUses: 8, uses: 7 }),   // 剩 1
      mkTrade({ out: 'bread', maxUses: 16, uses: 2 })   // 剩 14
    ]
    const pick = pickBestTrade(trades, 'bread', inv)
    expect(pick.index).to.equal(1)
  })
  it('售罄/付不起的不选', () => {
    const trades = [
      mkTrade({ out: 'diamond', uses: 16, maxUses: 16 }),
      mkTrade({ out: 'diamond', realPrice: 999 })
    ]
    expect(pickBestTrade(trades, 'diamond', inv)).to.equal(null)
  })
  it('无此产物返回 null', () => {
    expect(pickBestTrade([mkTrade({ out: 'wheat' })], 'shulker_shell', inv)).to.equal(null)
    expect(pickBestTrade([], 'x', inv)).to.equal(null)
    expect(pickBestTrade([mkTrade()], '', inv)).to.equal(null)
  })
  it('请求次数超过剩余次数的不选（修复：旧只查 soldOut，下单时 assert trade blocked）', () => {
    const trades = [mkTrade({ out: 'diamond', outCount: 1, maxUses: 16, uses: 14 })] // 剩 2
    expect(pickBestTrade(trades, 'diamond', inv, { count: 5 })).to.equal(null)   // 要 5 > 剩 2
    const ok = pickBestTrade(trades, 'diamond', inv, { count: 2 })               // 恰好 2 可选
    expect(ok).to.not.equal(null)
    expect(ok.count).to.equal(2)
  })
})

// ---------- createTrader 假 villager 编排 ----------

function makeVillager (trades) {
  const events = []
  const v = {
    trades,
    id: 7,
    async trade (index, count) {
      const t = trades[index]
      events.push(['trade', index, count, t.outputItem.name])
      // 模拟 mineflayer：剩余次数校验（assert trade blocked）
      if (t.maximumNbTradeUses - t.nbTradeUses < count) throw new Error('trade blocked')
      t.nbTradeUses += count
    },
    async close () { events.push(['close']) }
  }
  return { v, events }
}

function traderFor (trades, backpack) {
  const { v, events } = makeVillager(trades)
  const trader = createTrader({
    getBot: () => ({ entity: { position: { x: 0, y: 0, z: 0 } } }),
    findVillager: () => ({ name: 'villager', position: { x: 1, y: 64, z: 1, distanceTo: () => 2 } }),
    approachAndWait: async () => true,
    openVillager: async () => v,
    items: () => backpack,
    zhIdOf: () => null
  })
  return { trader, events }
}

describe('trade: createTrader 编排（假 villager 运行期）', () => {
  it('成功下单：产出/花费按次数放大，最终关市', async () => {
    const backpack = [{ name: 'emerald', count: 10 }]
    const trades = [mkTrade({ out: 'diamond', outCount: 1 })]
    const { trader, events } = traderFor(trades, backpack)
    const r = await trader('diamond', 3)
    expect(r.ok).to.equal(true)
    expect(r.output).to.equal('diamond')
    expect(r.count).to.equal(3)   // 1×3
    expect(r.price).to.equal(3)   // realPrice 1×3
    expect(events).to.deep.include(['close'])
  })

  it('村民无此产物：列出可换清单', async () => {
    const { trader } = traderFor([mkTrade({ out: 'wheat' })], [{ name: 'emerald', count: 5 }])
    const r = await trader('diamond', 1)
    expect(r.ok).to.equal(false)
    expect(r.reason).to.include('可换')
    expect(r.reason).to.include('wheat')
  })

  it('售罄交易不选', async () => {
    const trades = [mkTrade({ out: 'diamond', uses: 16, maxUses: 16 })]
    const { trader } = traderFor(trades, [{ name: 'emerald', count: 10 }])
    const r = await trader('diamond', 1)
    expect(r.ok).to.equal(false)
  })

  it('中文名经 zhIdOf 映射后仍可匹配', async () => {
    const trades = [mkTrade({ out: 'diamond', outCount: 1 })]
    const zhTrader = createTrader({
      getBot: () => ({ entity: { position: { x: 0, y: 0, z: 0 } } }),
      findVillager: () => ({ name: 'villager', position: { x: 1, y: 64, z: 1, distanceTo: () => 2 } }),
      approachAndWait: async () => true,
      openVillager: async () => makeVillager(trades).v,
      items: () => [{ name: 'emerald', count: 5 }],
      zhIdOf: (n) => (n === '钻石' ? 'diamond' : null)
    })
    const r = await zhTrader('钻石', 1)
    expect(r.ok).to.equal(true)
    expect(r.output).to.equal('diamond')
  })

  it('未连接时安全返回', async () => {
    const trader = createTrader({
      getBot: () => null,
      findVillager: () => ({ name: 'villager', position: { x: 0, y: 0, z: 0 } }),
      approachAndWait: async () => true,
      openVillager: async () => { throw new Error('should not open') },
      items: () => [], zhIdOf: () => null
    })
    const r = await trader('diamond', 1)
    expect(r.ok).to.equal(false)
    expect(r.reason).to.equal('未连接')
  })
})
