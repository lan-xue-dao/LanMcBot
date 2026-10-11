import { expect } from 'chai'
import { pickMineTarget, pickBestTool, nextAction } from '../lib/mining.mjs'

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
