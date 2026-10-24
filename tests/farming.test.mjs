import { expect } from 'chai'
import { CROPS, getCropInfo, isRipe, selectRipeCrops, replantSeed, createHarvester } from '../lib/farming.mjs'

// ---------- 假 bot 世界（模拟 mineflayer 语义：findBlocks 收 Block 判 name、返回方块；blockAt 带 _properties.age） ----------
function makeWorld (botX = 0, botZ = 0) {
  const cells = new Map() // "x,y,z" → { name, age }
  const key = (p) => `${p.x},${p.y},${p.z}`
  const mk = (p) => ({ x: p.x, y: p.y, z: p.z, distanceTo(q) { return Math.hypot(this.x - q.x, this.y - q.y, this.z - q.z) } })
  return {
    cells,
    plant (x, y, z, name, age) { cells.set(key({ x, y, z }), { name, age }) },
    bot: {
      entity: { position: mk({ x: botX, y: 64, z: botZ }) },
      once () {}
    },
    findBlocks ({ matching, maxDistance }) {
      const out = []
      for (const [k, c] of cells) {
        const [x, y, z] = k.split(',').map(Number)
        const p = mk({ x, y, z })
        const blockLike = { name: c.name, position: p }
        if (matching(blockLike) && p.distanceTo({ x: botX, y: 64, z: botZ }) <= maxDistance) out.push(p)
      }
      return out
    },
    blockAt (p) {
      const c = cells.get(key(p))
      return c ? { name: c.name, position: p, _properties: { age: c.age } } : null
    },
    digCount: 0,
    async dig (block) { this.digCount++; cells.delete(key(block.position)) },
    placed: [],
    async placeBlock (name, x, y, z) { this.placed.push({ name, x, y, z }) },
    seeds: new Set(),
    approached: []
  }
}

function harness (w, { max, replant = true } = {}) {
  let fakeTime = 0
  return createHarvester({
    getBot: () => w.bot,
    findBlocks: (o) => w.findBlocks(o),
    blockAt: (p) => w.blockAt(p),
    dig: (b) => w.dig(b),
    hasItem: (n) => w.seeds.has(n),
    placeBlock: (n, x, y, z) => w.placeBlock(n, x, y, z),
    withinReach: (pos) => w.bot.entity.position.distanceTo(pos) <= 4.5,
    approachAndWait: async (pos) => { w.approached.push(pos); w.bot.entity.position = { ...w.bot.entity.position, x: pos.x, y: pos.y + 1, z: pos.z } },
    sleep: async () => {},
    now: () => fakeTime++ // 每次调用推进 1ms，远低于 60000 超时，循环靠业务条件自然退出
  })({ radius: 32, max, replant })
}

describe('farming: getCropInfo', () => {
  it('已知作物返回收获参数', () => {
    expect(getCropInfo('wheat')).to.deep.equal({ ripeAge: 7, replant: 'wheat_seeds', produce: 'wheat' })
    expect(getCropInfo('cocoa').ripeAge).to.equal(2)
  })
  it('大小写/空格不敏感', () => {
    expect(getCropInfo(' WHEAT ')).to.not.equal(null)
  })
  it('非作物返回 null', () => {
    expect(getCropInfo('stone')).to.equal(null)
    expect(getCropInfo('air')).to.equal(null)
    expect(getCropInfo(null)).to.equal(null)
  })
  it('melon_stem 未纳入（依赖相邻生成，复杂），不视为可自动收作物', () => {
    expect(getCropInfo('melon_stem')).to.equal(null)
  })
})

describe('farming: isRipe', () => {
  it('达到 ripeAge 才算成熟', () => {
    expect(isRipe('wheat', 7)).to.equal(true)
    expect(isRipe('wheat', 6)).to.equal(false)
    expect(isRipe('nether_wart', 3)).to.equal(true)
    expect(isRipe('cocoa', 2)).to.equal(true)
    expect(isRipe('cocoa', 1)).to.equal(false)
  })
  it('非作物 / age 缺失返回 false', () => {
    expect(isRipe('stone', 7)).to.equal(false)
    expect(isRipe('wheat', undefined)).to.equal(false)
    expect(isRipe('wheat', null)).to.equal(false)
  })
})

describe('farming: selectRipeCrops', () => {
  it('筛出成熟作物', () => {
    const blocks = [
      { name: 'wheat', age: 7 },
      { name: 'wheat', age: 3 },
      { name: 'carrots', age: 7 },
      { name: 'dirt', age: 7 }
    ]
    const ripe = selectRipeCrops(blocks)
    expect(ripe).to.have.lengthOf(2)
    expect(ripe.map(b => b.name)).to.deep.equal(['wheat', 'carrots'])
  })
  it('空输入安全', () => {
    expect(selectRipeCrops(undefined)).to.deep.equal([])
    expect(selectRipeCrops([])).to.deep.equal([])
  })
})

describe('farming: replantSeed', () => {
  it('作物给出补种种子', () => {
    expect(replantSeed('wheat')).to.equal('wheat_seeds')
    expect(replantSeed('beetroots')).to.equal('beetroot_seeds')
    expect(replantSeed('carrots')).to.equal('carrot') // 胡萝卜以自身补种
  })
  it('浆果丛不补种 / 非作物 null', () => {
    expect(replantSeed('sweet_berry_bush')).to.equal(null)
    expect(replantSeed('stone')).to.equal(null)
  })
})

describe('farming: createHarvester 编排（假 bot 运行期）', () => {
  it('收获成熟小麦并补种', async () => {
    const w = makeWorld(0, 0)
    w.plant(1, 64, 1, 'wheat', 7)
    w.plant(2, 64, 1, 'wheat', 7)
    w.seeds.add('wheat_seeds')
    const r = await harness(w)
    expect(r.ok).to.equal(true)
    expect(r.harvested).to.equal(2)
    expect(r.replanted).to.equal(2)
    expect(w.digCount).to.equal(2)
    expect(w.placed.every(p => p.name === 'wheat_seeds')).to.equal(true)
  })

  it('只收成熟（age 达标）的作物', async () => {
    const w = makeWorld(0, 0)
    w.plant(1, 64, 0, 'wheat', 3) // 未熟
    w.plant(1, 64, 1, 'wheat', 7) // 成熟
    const r = await harness(w, { replant: false })
    expect(r.harvested).to.equal(1)
    // 未熟的那格仍在世界里
    expect(w.cells.size).to.equal(1)
  })

  it('远处成熟作物走近后再收', async () => {
    const w = makeWorld(0, 0)
    w.plant(10, 64, 0, 'carrots', 7) // 10 格外，超出触及 4.5
    const r = await harness(w, { replant: false })
    expect(r.harvested).to.equal(1)
    expect(w.approached.length).to.be.greaterThan(0) // 确实走近过
  })

  it('无成熟作物时安全收工', async () => {
    const w = makeWorld(0, 0)
    w.plant(1, 64, 1, 'stone', 0) // 非作物
    const r = await harness(w)
    expect(r.ok).to.equal(true)
    expect(r.harvested).to.equal(0)
    expect(r.replanted).to.equal(0)
  })

  it('max 限制收获数量', async () => {
    const w = makeWorld(0, 0)
    for (let i = 1; i <= 5; i++) w.plant(i, 64, 0, 'potatoes', 7)
    const r = await harness(w, { max: 2, replant: false })
    expect(r.harvested).to.equal(2)
    expect(w.digCount).to.equal(2)
  })

  it('无种子时仍收获、不补种', async () => {
    const w = makeWorld(0, 0)
    w.plant(1, 64, 0, 'wheat', 7)
    // w.seeds 空
    const r = await harness(w)
    expect(r.harvested).to.equal(1)
    expect(r.replanted).to.equal(0)
  })
})
