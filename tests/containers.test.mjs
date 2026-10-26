import { expect } from 'chai'
import { planDeposit, planWithdraw, pickNearestContainer, createContainerOps } from '../lib/containers.mjs'

function pos(x, y, z) {
  return { x, y, z, distanceTo(p) { return Math.hypot(this.x - p.x, this.y - p.y, this.z - p.z) } }
}

describe('containers: planDeposit', () => {
  it('过滤 keep 集合内的物品', () => {
    const keep = new Set(['diamond_sword', 'bread'])
    const r = planDeposit([
      { name: 'diamond_sword', count: 1, slot: 36 },
      { name: 'bread', count: 3, slot: 37 },
      { name: 'cobblestone', count: 64, slot: 0 },
      { name: 'dirt', count: 12, slot: 1 }
    ], { keep })
    expect(r).to.deep.equal([
      { name: 'cobblestone', count: 64 },
      { name: 'dirt', count: 12 }
    ])
  })
  it('depositAll=true 时无视 keep 全存', () => {
    const r = planDeposit([
      { name: 'diamond_sword', count: 1, slot: 36 },
      { name: 'cobblestone', count: 32, slot: 0 }
    ], { keep: new Set(['diamond_sword']), depositAll: true })
    expect(r).to.deep.equal([
      { name: 'cobblestone', count: 32 },
      { name: 'diamond_sword', count: 1 }
    ])
  })
  it('按数量降序排列', () => {
    const r = planDeposit([
      { name: 'a', count: 1 },
      { name: 'b', count: 99 },
      { name: 'c', count: 10 }
    ])
    expect(r.map(i => i.name)).to.deep.equal(['b', 'c', 'a'])
  })
  it('缺 count 视为 1', () => {
    expect(planDeposit([{ name: 'stick' }])).to.deep.equal([{ name: 'stick', count: 1 }])
  })
  it('跳过无名字的非法条目；空/缺参返回空数组', () => {
    expect(planDeposit([null, undefined, { count: 5 }, { name: '' }])).to.deep.equal([])
    expect(planDeposit([])).to.deep.equal([])
    expect(planDeposit()).to.deep.equal([])
  })
})

describe('containers: planWithdraw', () => {
  const chest = [
    { name: 'iron_ingot', count: 12 },
    { name: 'IRON-INGOT', count: 8 },
    { name: 'gold_ingot', count: 3 }
  ]
  it('目标充足时按请求数量返回', () => {
    expect(planWithdraw(chest, 'iron_ingot', 10)).to.deep.equal({ name: 'iron_ingot', count: 10 })
  })
  it('同名不同写法（大小写/连字符）合并计数', () => {
    expect(planWithdraw(chest, 'iron-ingot', 100)).to.deep.equal({ name: 'iron-ingot', count: 20 })
  })
  it('箱内不足时取全部', () => {
    expect(planWithdraw(chest, 'gold_ingot', 10)).to.deep.equal({ name: 'gold_ingot', count: 3 })
  })
  it('箱内没有目标物品返回 null', () => {
    expect(planWithdraw(chest, 'diamond', 1)).to.equal(null)
  })
  it('count 缺省按 1 取', () => {
    expect(planWithdraw(chest, 'gold_ingot')).to.deep.equal({ name: 'gold_ingot', count: 1 })
  })
  it('空箱子/空参数返回 null', () => {
    expect(planWithdraw([], 'apple', 1)).to.equal(null)
    expect(planWithdraw(chest, '', 1)).to.equal(null)
    expect(planWithdraw(chest, null, 1)).to.equal(null)
  })
})

describe('containers: pickNearestContainer', () => {
  const botPos = pos(0, 0, 0)
  it('从多种方块中挑最近的容器', () => {
    const blocks = [
      { name: 'stone', position: pos(1, 0, 0) },
      { name: 'barrel', position: pos(2, 0, 0) },
      { name: 'chest', position: pos(5, 0, 0) }
    ]
    const r = pickNearestContainer(blocks, botPos)
    expect(r.block.name).to.equal('barrel')
    expect(r.distance).to.be.closeTo(2, 1e-6)
  })
  it('trapped_chest 也算容器', () => {
    const blocks = [{ name: 'trapped_chest', position: pos(3, 0, 0) }]
    const r = pickNearestContainer(blocks, botPos)
    expect(r.block.name).to.equal('trapped_chest')
  })
  it('超出 maxDistance 的容器被跳过', () => {
    const blocks = [{ name: 'chest', position: pos(20, 0, 0) }]
    expect(pickNearestContainer(blocks, botPos, 16)).to.equal(null)
  })
  it('只留远容器时返回 null', () => {
    const blocks = [
      { name: 'chest', position: pos(30, 0, 0) },
      { name: 'barrel', position: pos(40, 0, 0) }
    ]
    expect(pickNearestContainer(blocks, botPos, 16)).to.equal(null)
  })
  it('非容器方块不算距离候选', () => {
    const blocks = [{ name: 'furnace', position: pos(1, 0, 0) }]
    expect(pickNearestContainer(blocks, botPos)).to.equal(null)
  })
  it('缺 position 的条目被跳过；空列表返回 null', () => {
    expect(pickNearestContainer([{ name: 'chest' }], botPos)).to.equal(null)
    expect(pickNearestContainer([], botPos)).to.equal(null)
    expect(pickNearestContainer(null, botPos)).to.equal(null)
  })
})


// ---------- createContainerOps 编排（假箱子）：覆盖 lead 点名的 5 类坑 ----------

// 假箱子：槽位数组，deposit 自动并堆（复刻 mineflayer 语义），可选装满/抛错/超时
function makeChest ({ slots = [], full = false, throwOnDeposit = false, hang = false } = {}) {
  const chest = {
    slots,
    events: [],
    items: () => chest.slots.filter(Boolean),
    async deposit (type, meta, n) {
      if (hang) return new Promise(() => {})          // 永不 resolve：测开箱/存物超时收敛
      if (throwOnDeposit || full) throw new Error('chest is full')
      chest.events.push(['deposit', type, n])
      // 并堆语义：同 type 已有则加进去（不新增槽）
      const exist = chest.slots.find(s => s && s.type === type)
      if (exist) exist.count += n
      else chest.slots.push({ type, metadata: meta, count: n, name: `item${type}` })
    },
    async withdraw (type, meta, n) {
      if (throwOnDeposit) throw new Error('inventory full')
      const s = chest.slots.find(x => x && x.type === type)
      if (!s) throw new Error('not in chest')
      s.count -= n
      chest.events.push(['withdraw', type, n])
      if (s.count <= 0) chest.slots = chest.slots.filter(x => x !== s)
    },
    async close () { chest.events.push(['close']) }
  }
  return chest
}

function opsFor (chest, { backpack = [], containerBlock = { name: 'chest' }, openHang = false } = {}) {
  return createContainerOps({
    getBot: () => ({ entity: { position: { x: 0, y: 0, z: 0 } }, inventory: { items: () => backpack } }),
    findContainer: () => containerBlock,
    openContainer: async () => { if (openHang) return new Promise(() => {}); return chest },
    items: () => backpack,
    zhIdOf: () => null,
    openTimeoutMs: 200
  })
}

describe('containers: createContainerOps 编排', () => {
  it('正常存入：按类型逐格存，关箱必定执行', async () => {
    const chest = makeChest()
    const backpack = [{ name: 'dirt', count: 10, slot: 9, type: 1, metadata: 0 }]
    const r = await opsFor(chest, { backpack }).deposit([])
    expect(r.ok).to.equal(true)
    expect(r.deposited).to.deep.equal([{ name: 'dirt', count: 10 }])
    expect(chest.events.map(e => e[0])).to.include('close')
  })

  it('坑①箱子满：安全返回 ok:false 而不是覆盖已有物品', async () => {
    const chest = makeChest({ full: true })
    const backpack = [{ name: 'dirt', count: 5, slot: 9, type: 1, metadata: 0 }]
    const r = await opsFor(chest, { backpack }).deposit([])
    expect(r.ok).to.equal(false)
    expect(r.reason).to.include('满')
    expect(chest.events.some(e => e[0] === 'deposit')).to.equal(false)  // 没写入任何东西
  })

  it('坑③开箱超时：超时收敛并报错（不永久挂起）', async () => {
    const chest = makeChest()
    const backpack = [{ name: 'dirt', count: 1, slot: 9, type: 1, metadata: 0 }]
    const r = await opsFor(chest, { backpack, openHang: true }).deposit([])
    expect(r.ok).to.equal(false)
    expect(r.reason).to.include('超时')
  })

  it('坑②容器消失：findContainer 返回 null → 明确报错不崩', async () => {
    const chest = makeChest()
    const backpack = [{ name: 'dirt', count: 1, slot: 9, type: 1, metadata: 0 }]
    const r = await opsFor(chest, { backpack, containerBlock: null }).deposit([])
    expect(r.ok).to.equal(false)
    expect(r.reason).to.include('没有箱子')
  })

  it('坑④存物时窗口关闭：捕获为 ok:false 不崩，仍关箱', async () => {
    const chest = makeChest({ throwOnDeposit: true })
    const backpack = [{ name: 'dirt', count: 3, slot: 9, type: 1, metadata: 0 }]
    const r = await opsFor(chest, { backpack }).deposit([])
    expect(r.ok).to.equal(false)
    expect(chest.events.map(e => e[0])).to.include('close')
  })

  it('坑⑤并堆语义：取出 3 个走 chest.withdraw，数量精确', async () => {
    const chest = makeChest({ slots: [{ type: 1, metadata: 0, count: 8, name: 'dirt' }] })
    const r = await opsFor(chest).withdraw('dirt', 3)
    expect(r.ok).to.equal(true)
    expect(r.count).to.equal(3)
    expect(chest.slots[0].count).to.equal(5)   // 8 - 3，同一个堆变少，不是删掉一个堆
  })

  it('取不存在物品 / 背包满取部分：安全返回', async () => {
    const chest = makeChest({ slots: [{ type: 1, metadata: 0, count: 8, name: 'dirt' }] })
    expect((await opsFor(chest).withdraw('diamond', 1)).reason).to.include('没有')
    const fullChest = makeChest({ slots: [{ type: 1, metadata: 0, count: 8, name: 'dirt' }], throwOnDeposit: true })
    expect((await opsFor(fullChest).withdraw('dirt', 3)).ok).to.equal(false)
  })
})