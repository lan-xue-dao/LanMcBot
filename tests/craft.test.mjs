import { expect } from 'chai'
import { canCraft, ingredientsNeeded, matchCraftableByName, countItem } from '../lib/craft.mjs'

const plank = { result: { name: 'crafting_table', count: 1 }, ingredients: [{ name: 'oak_planks', count: 4 }] }
const stick = { result: { name: 'stick', count: 4 }, ingredients: [{ name: 'oak_planks', count: 2 }] }

describe('craft: ingredientsNeeded', () => {
  it('单次合成按配方展开', () => {
    expect(ingredientsNeeded(plank, 1)).to.deep.equal([{ name: 'oak_planks', count: 4 }])
  })
  it('多批次按 ceil(count/result.count) 倍率合并', () => {
    // 6 根木棍 = 2 批（每批 4 根），每批 2 木板 → 4 木板
    expect(ingredientsNeeded(stick, 6)).to.deep.equal([{ name: 'oak_planks', count: 4 }])
  })
  it('同名材料合并', () => {
    const r = { result: { name: 'x', count: 1 }, ingredients: [{ name: 'a', count: 2 }, { name: 'a', count: 3 }] }
    expect(ingredientsNeeded(r, 1)).to.deep.equal([{ name: 'a', count: 5 }])
  })
})

describe('craft: canCraft', () => {
  const inv = [{ name: 'oak_planks', count: 5 }, { name: 'apple', count: 1 }]
  it('材料足够返回 ok', () => {
    expect(canCraft(plank, inv, 1).ok).to.equal(true)
  })
  it('材料不足列出缺什么', () => {
    const r = canCraft(plank, inv, 2) // 需要 8 木板，只有 5
    expect(r.ok).to.equal(false)
    expect(r.missing).to.deep.equal([{ name: 'oak_planks', need: 8, have: 5 }])
  })
  it('空背包全缺', () => {
    const r = canCraft(plank, [], 1)
    expect(r.ok).to.equal(false)
    expect(r.missing[0].have).to.equal(0)
  })
})

describe('craft: matchCraftableByName', () => {
  const recipes = [plank, stick]
  it('英文名直接匹配', () => {
    expect(matchCraftableByName(recipes, 'stick').result.name).to.equal('stick')
  })
  it('中文名经 zhToId 映射后匹配', () => {
    const r = matchCraftableByName(recipes, '木棍', zh => (zh === '木棍' ? 'stick' : null))
    expect(r).to.equal(stick)
  })
  it('无匹配返回 null', () => {
    expect(matchCraftableByName(recipes, 'diamond')).to.equal(null)
  })
})

describe('craft: countItem', () => {
  it('按归一化名统计', () => {
    const inv = [{ name: 'oak_planks', count: 3 }, { name: 'OAK-PLANKS', count: 2 }]
    expect(countItem(inv, 'oak_planks')).to.equal(5)
  })
  it('无匹配为 0', () => {
    expect(countItem([{ name: 'apple', count: 1 }], 'stick')).to.equal(0)
  })
})
