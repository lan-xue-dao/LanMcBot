import { expect } from 'chai'
import { fuelTicks, pickFuel, nextFurnaceAction } from '../lib/smelt.mjs'

describe('smelt: fuelTicks', () => {
  it('标准燃料返回燃烧刻数', () => {
    expect(fuelTicks('coal')).to.equal(1600)
    expect(fuelTicks('coal_block')).to.equal(16000)
    expect(fuelTicks('lava_bucket')).to.equal(20000)
    expect(fuelTicks('blaze_rod')).to.equal(2400)
  })
  it('木制品族兜底', () => {
    expect(fuelTicks('oak_planks')).to.equal(300)
    expect(fuelTicks('spruce_log')).to.equal(300)
    expect(fuelTicks('stick')).to.equal(100)
  })
  it('非燃料返回 0', () => {
    expect(fuelTicks('iron_ingot')).to.equal(0)
    expect(fuelTicks('dirt')).to.equal(0)
    expect(fuelTicks(null)).to.equal(0)
    expect(fuelTicks('')).to.equal(0)
  })
  it('大小写/空格不敏感', () => {
    expect(fuelTicks(' COAL ')).to.equal(1600)
    expect(fuelTicks('Charcoal'.toLowerCase())).to.equal(1600)
  })
})

describe('smelt: pickFuel', () => {
  it('挑燃烧时间最长的燃料', () => {
    const items = [
      { name: 'stick', count: 10 },
      { name: 'coal', count: 3 },
      { name: 'oak_planks', count: 20 }
    ]
    const f = pickFuel(items)
    expect(f.name).to.equal('coal')
    expect(f.ticks).to.equal(1600)
  })
  it('exclude 排除指定物品', () => {
    const items = [{ name: 'coal', count: 5 }, { name: 'oak_planks', count: 8 }]
    const f = pickFuel(items, { exclude: new Set(['coal']) })
    expect(f.name).to.equal('oak_planks')
  })
  it('无燃料返回 null', () => {
    expect(pickFuel([{ name: 'iron_ingot', count: 1 }])).to.equal(null)
    expect(pickFuel([])).to.equal(null)
  })
})

describe('smelt: nextFurnaceAction', () => {
  it('产出占位先取出', () => {
    expect(nextFurnaceAction({ outputOccupied: true, needsFuel: false, inputEmpty: false })).to.equal('take_output')
  })
  it('缺燃料优先补燃料', () => {
    expect(nextFurnaceAction({ outputOccupied: false, needsFuel: true, inputEmpty: false })).to.equal('add_fuel')
  })
  it('空料补料', () => {
    expect(nextFurnaceAction({ outputOccupied: false, needsFuel: false, inputEmpty: true })).to.equal('fill_input')
  })
  it('都在位就等待', () => {
    expect(nextFurnaceAction({ outputOccupied: false, needsFuel: false, inputEmpty: false })).to.equal('wait')
  })
})
