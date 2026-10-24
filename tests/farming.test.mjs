import { expect } from 'chai'
import { CROPS, getCropInfo, isRipe, selectRipeCrops, replantSeed } from '../lib/farming.mjs'

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
