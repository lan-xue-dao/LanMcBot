import { expect } from 'chai'
import { formatEnchantOptions, enchantOptionsReady, pickEnchantOption, createEnchanter } from '../lib/enchant.mjs'

// mineflayer 真实结构：level = 所需经验档；-1 表示未就绪
function opts(a, b, c) {
  return [
    { level: a.xp, expected: { enchant: a.e, level: a.el } },
    { level: b.xp, expected: { enchant: b.e, level: b.el } },
    { level: c.xp, expected: { enchant: c.e, level: c.el } }
  ]
}
const READY = opts({ xp: 1, e: 5, el: 1 }, { xp: 2, e: 6, el: 2 }, { xp: 3, e: 7, el: 3 })

describe('enchant: formatEnchantOptions', () => {
  it('归一化三选项（choice/xpLevel/predicted）', () => {
    const f = formatEnchantOptions(READY)
    expect(f).to.have.lengthOf(3)
    expect(f[2]).to.deep.equal({ choice: 2, xpLevel: 3, predicted: { enchant: 7, level: 3 } })
  })
  it('expected 为 -1 时 predicted 置 null（离线服务器无 seed）', () => {
    const f = formatEnchantOptions(opts({ xp: 1, e: -1, el: -1 }, { xp: 2, e: 6, el: 2 }, { xp: 3, e: 7, el: 3 }))
    expect(f[0].predicted).to.equal(null)
    expect(f[1].predicted).to.deep.equal({ enchant: 6, level: 2 })
  })
  it('未就绪选项 xpLevel=-1 保留', () => {
    const f = formatEnchantOptions(opts({ xp: -1, e: -1, el: -1 }, { xp: -1, e: -1, el: -1 }, { xp: -1, e: -1, el: -1 }))
    expect(f.every(o => o.xpLevel === -1)).to.equal(true)
  })
  it('空/缺省安全', () => {
    expect(formatEnchantOptions(undefined)).to.deep.equal([])
  })
})

describe('enchant: enchantOptionsReady', () => {
  it('三者 level>=0 → ready', () => {
    expect(enchantOptionsReady(READY)).to.equal(true)
  })
  it('任一 -1 → 未就绪', () => {
    expect(enchantOptionsReady(opts({ xp: 1, e: 5, el: 1 }, { xp: -1, e: -1, el: -1 }, { xp: 3, e: 7, el: 3 }))).to.equal(false)
  })
  it('不足 3 项不算就绪', () => {
    expect(enchantOptionsReady([{ level: 1 }])).to.equal(false)
  })
})

describe('enchant: pickEnchantOption', () => {
  it('默认 best：取经验档最高', () => {
    expect(pickEnchantOption(READY, { botLevel: 10 })).to.deep.equal({ choice: 2, xpLevel: 3 })
  })
  it('cheap：取最低档省经验', () => {
    expect(pickEnchantOption(READY, { botLevel: 10, prefer: 'cheap' })).to.deep.equal({ choice: 0, xpLevel: 1 })
  })
  it('经验不足时降级到付得起的档', () => {
    expect(pickEnchantOption(READY, { botLevel: 2 })).to.deep.equal({ choice: 1, xpLevel: 2 })
  })
  it('一档都付不起返回 null', () => {
    expect(pickEnchantOption(READY, { botLevel: 0 })).to.equal(null)
  })
  it('未就绪（全 -1）返回 null', () => {
    const notReady = opts({ xp: -1, e: -1, el: -1 }, { xp: -1, e: -1, el: -1 }, { xp: -1, e: -1, el: -1 })
    expect(pickEnchantOption(notReady, { botLevel: 30 })).to.equal(null)
  })
  it('botLevel 缺省 0 时返回 null', () => {
    expect(pickEnchantOption(READY, {})).to.equal(null)
  })
})


// ---------- createEnchanter 编排（假附魔台）：覆盖四类挂起源头 ----------

function makeTable ({ ready = true, failOnEnchant = false, readyAfter = 0 } = {}) {
  let poll = 0
  const table = {
    enchantments: ready ? READY : opts({ xp: -1, e: -1, el: -1 }, { xp: -1, e: -1, el: -1 }, { xp: -1, e: -1, el: -1 }),
    events: [],
    async putTargetItem (it) { this.events.push(['put_target', it.name]) },
    async putLapis (it) { this.events.push(['put_lapis', it.name]) },
    async takeTargetItem () { this.events.push(['take_target']) },
    async enchant (choice) {
      if (failOnEnchant) throw new Error('window closed')
      this.events.push(['enchant', choice])
      return { name: 'diamond_sword' }
    },
    async close () { this.events.push(['close']) }
  }
  return table
}

function enchanterFor (table, { items = [], level = 30, tableBlock = { name: 'enchanting_table' }, approachOk = true } = {}) {
  let t = 0
  const enchanter = createEnchanter({
    getBot: () => ({ entity: { position: { x: 0, y: 0, z: 0 } }, experience: { level } }),
    approachAndWait: async () => approachOk,
    openTable: async () => table,
    findTableBlock: () => tableBlock,
    items: () => items,
    zhIdOf: () => null,
    sleep: async () => {},
    now: () => (t += 100),          // 每次推进 100ms；readyTimeoutMs 内会轮询若干次
    readyTimeoutMs: 500
  })
  return enchanter
}

describe('enchant: createEnchanter 编排', () => {
  const sword = { name: 'diamond_sword', count: 1 }
  const lapis = { name: 'lapis_lazuli', count: 3 }

  it('正常附魔：放料 → 选最佳档 → 取回 → 关台', async () => {
    const table = makeTable()
    const r = await enchanterFor(table, { items: [sword, lapis] })('diamond_sword', 1)
    expect(r.ok).to.equal(true)
    expect(r.enchanted).to.equal(1)
    expect(r.results[0].choice).to.equal(2)          // best = 最高档
    expect(table.events).to.deep.include(['close'])
  })

  it('挂起源头②：选项始终未就绪 → 超时收敛并取回物品（不永久挂起）', async () => {
    const table = makeTable({ ready: false })
    const r = await enchanterFor(table, { items: [sword, lapis] })('diamond_sword', 1)
    expect(r.ok).to.equal(false)
    expect(r.reason).to.include('未就绪')
    expect(table.events.map(e => e[0])).to.include('take_target')   // 物品被取回，没卡在台子里
  })

  it('挂起源头③：经验不足 → 明确报所需等级', async () => {
    const table = makeTable()
    const r = await enchanterFor(table, { items: [sword, lapis], level: 1 })('diamond_sword', 1)
    expect(r.ok).to.equal(false)
    expect(r.reason).to.include('经验等级不足')
  })

  it('挂起源头④：附魔时窗口被关 → 捕获为错误而非崩溃', async () => {
    const table = makeTable({ failOnEnchant: true })
    const r = await enchanterFor(table, { items: [sword, lapis] })('diamond_sword', 1)
    expect(r.ok).to.equal(false)
    expect(r.reason).to.include('window closed')
  })

  it('无青金石 / 无附魔台 / 到不了 / 未连接 均安全返回', async () => {
    expect((await enchanterFor(makeTable(), { items: [sword] })('diamond_sword')).reason).to.include('青金石')
    expect((await enchanterFor(makeTable(), { items: [sword, lapis], tableBlock: null })('diamond_sword')).reason).to.include('附魔台')
    expect((await enchanterFor(makeTable(), { items: [sword, lapis], approachOk: false })('diamond_sword')).reason).to.include('无法走近')
    const noBot = createEnchanter({ getBot: () => null, approachAndWait: async () => true, openTable: async () => ({}), findTableBlock: () => ({}), items: () => [], zhIdOf: () => null, sleep: async () => {} })
    expect((await noBot('x')).reason).to.equal('未连接')
  })
})