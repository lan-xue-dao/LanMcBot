import { expect } from 'chai'
import { pickMineTarget, pickBestTool, nextAction, createMiner } from '../lib/mining.mjs'

function pos(x, y, z) {
  return { x, y, z, distanceTo(p) { return Math.hypot(this.x - p.x, this.y - p.y, this.z - p.z) } }
}

describe('mining: pickMineTarget', () => {
  const botPos = pos(0, 0, 0)
  it('只挑名字匹配且可挖的最近方块', () => {
    const blocks = [
      { name: 'stone', position: pos(1, 0, 0) },
      { name: 'dirt', position: pos(2, 0, 0) },
      { name: 'oak_log', position: pos(5, 0, 0) }
    ]
    const r = pickMineTarget(blocks, botPos, { match: n => n === 'stone' || n === 'oak_log' })
    expect(r.block.name).to.equal('stone')
    expect(r.distance).to.be.closeTo(1, 1e-6)
  })
  it('diggable=false 的方块被跳过', () => {
    const blocks = [{ name: 'stone', position: pos(1, 0, 0) }]
    const r = pickMineTarget(blocks, botPos, { match: () => true, diggable: () => false })
    expect(r).to.equal(null)
  })
  it('超出半径返回 null', () => {
    const blocks = [{ name: 'stone', position: pos(100, 0, 0) }]
    expect(pickMineTarget(blocks, botPos, { match: () => true, maxDistance: 32 })).to.equal(null)
  })
})

describe('mining: pickBestTool', () => {
  it('石头选镐且最高材质优先', () => {
    const items = [{ name: 'wooden_pickaxe' }, { name: 'iron_pickaxe' }, { name: 'diamond_axe' }]
    expect(pickBestTool('stone', items).name).to.equal('iron_pickaxe')
  })
  it('原木选斧', () => {
    expect(pickBestTool('oak_log', [{ name: 'iron_axe' }]).name).to.equal('iron_axe')
  })
  it('泥土选锹', () => {
    expect(pickBestTool('dirt', [{ name: 'iron_shovel' }]).name).to.equal('iron_shovel')
  })
  it('无匹配工具/空手可挖返回 null', () => {
    expect(pickBestTool('stone', [{ name: 'iron_axe' }])).to.equal(null)
    expect(pickBestTool('dirt', [])).to.equal(null)
  })
})

describe('mining: nextAction', () => {
  it('在触及距离内就挖', () => {
    expect(nextAction({ dx: 1, dy: 0, dz: 0, reach: 4.5 })).to.equal('dig')
  })
  it('超出触及距离先走', () => {
    expect(nextAction({ dx: 5, dy: 0, dz: 0, reach: 4.5 })).to.equal('walk')
  })
})

// ---------- createMiner 假 bot 编排 ----------

function makeMineWorld (blocks, botPos = pos(0, 0, 0)) {
  // blocks: [{name, x, y, z, diggable?}]
  const cells = blocks.map(b => ({
    ...b,
    position: pos(b.x, b.y, b.z),
    hardness: b.diggable === false ? Infinity : 1.5,
    diggable: b.diggable !== false
  }))
  const world = {
    bot: { entity: { position: botPos } },
    dug: [],
    equipped: [],
    approached: [],
    items: [{ name: 'iron_pickaxe' }],
    findBlocks ({ matching, maxDistance }) {
      return cells
        .filter(c => matching(c) && c.position.distanceTo(botPos) <= maxDistance)
        .map(c => c.position)
    },
    blockAt (p) {
      const c = cells.find(x => x.position.x === p.x && x.position.y === p.y && x.position.z === p.z)
      return c || null
    }
  }
  const miner = createMiner({
    getBot: () => world.bot,
    findBlocks: (o) => world.findBlocks(o),
    blockAt: (p) => world.blockAt(p),
    dig: async (b) => {
      // 复现 mineflayer dig 的前置：block.digTime(...) TypeError if stripped
      if (!b || typeof b.hardness !== 'number') throw new TypeError('block.digTime is not a function (stripped block)')
      if (b.hardness === Infinity) throw new Error(`dig time for ${b.name} is Infinity`)
      if (!b.diggable) throw new Error('not diggable')
      world.dug.push(b.name)
    },
    items: () => world.items,
    equipItem: async (name) => { world.equipped.push(name) },
    zhIdOf: () => null,
    approachAndWait: async (tp) => { world.approached.push(tp); botPos.x = tp.x - 2; botPos.z = tp.z - 2 },
    sleep: async () => {},
    now: (() => { let t = 0; return () => (t += 5) })()
  })
  return { miner, world }
}

describe('mining: createMiner 编排（假 bot 运行期）', () => {
  it('挖到指定数量的目标方块并传完整 Block 给 dig（防回归：不能剥成 {name,position}）', async () => {
    const { miner, world } = makeMineWorld([
      { name: 'stone', x: 1, y: 0, z: 0 },
      { name: 'stone', x: 2, y: 0, z: 0 },
      { name: 'dirt', x: 1, y: 0, z: 1 }
    ])
    const r = await miner('stone', 2)
    expect(r.ok).to.equal(true)
    expect(r.dug).to.equal(2)
    expect(world.dug).to.deep.equal(['stone', 'stone'])
  })

  it('石头自动装备镐', async () => {
    const { miner, world } = makeMineWorld([{ name: 'stone', x: 1, y: 0, z: 0 }])
    const r = await miner('stone', 1)
    expect(r.dug).to.equal(1)
    expect(world.equipped).to.include('iron_pickaxe')
  })

  it('不可挖方块（基岩）报未找到而不进死循环', async () => {
    const { miner, world } = makeMineWorld([{ name: 'bedrock', x: 1, y: 0, z: 0 }])
    const r = await miner('bedrock', 1)
    expect(r.ok).to.equal(false)
    expect(r.dug).to.equal(0)
    expect(world.dug).to.deep.equal([])
  })

  it('远处目标先走近再挖', async () => {
    const { miner, world } = makeMineWorld([{ name: 'diamond_ore', x: 10, y: 0, z: 10 }])
    const r = await miner('diamond_ore', 1)
    expect(r.ok).to.equal(true)
    expect(r.dug).to.equal(1)
    expect(world.approached.length).to.be.greaterThan(0)
  })

  it('未连接时安全返回', async () => {
    const miner = createMiner({
      getBot: () => null,
      findBlocks: () => [], blockAt: () => null, dig: async () => {},
      items: () => [], equipItem: async () => {}, zhIdOf: () => null,
      approachAndWait: async () => {}, sleep: async () => {}
    })
    const r = await miner('stone', 1)
    expect(r.ok).to.equal(false)
    expect(r.reason).to.equal('未连接')
  })
})
