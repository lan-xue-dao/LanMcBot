import { expect } from 'chai'
import { generateBlueprint, checkBlueprint } from '../lib/build.mjs'

describe('build: generateBlueprint', () => {
  it('wall：沿较长水平轴铺竖直平面', () => {
    // x 跨度 3 > z 跨度 0 → 沿 x 铺，z 固定，y 铺满
    const cells = generateBlueprint('wall', { x: 0, y: 64, z: 10 }, { x: 3, y: 66, z: 10 })
    expect(cells).to.have.lengthOf(4 * 3) // 4 x 3 层
    expect(cells.every(c => c.z === 10)).to.equal(true)
    expect(cells.every(c => c.y >= 64 && c.y <= 66)).to.equal(true)
  })
  it('floor：单层水平面', () => {
    const cells = generateBlueprint('floor', { x: 0, y: 60, z: 0 }, { x: 2, y: 60, z: 2 })
    expect(cells).to.have.lengthOf(9) // 3x3
    expect(cells.every(c => c.y === 60)).to.equal(true)
  })
  it('box：只出外壳不含内部', () => {
    const cells = generateBlueprint('box', { x: 0, y: 0, z: 0 }, { x: 2, y: 1, z: 2 })
    const set = new Set(cells.map(c => `${c.x},${c.y},${c.z}`))
    expect(set.has('1,0,1')).to.equal(true)  // 底面边上是壳
    expect(set.has('1,1,1')).to.equal(true)  // 顶面也是壳
    expect(cells).to.have.lengthOf(new Set(cells.map(c => `${c.x},${c.y},${c.z}`)).size)
    // 3x2x3 空心 = 总 18 - 内部 0（y 只有 0/1 两层无内部层）→ 全壳 18？验证无重复且含角点
    expect(set.has('0,0,0')).to.equal(true)
    expect(set.has('2,1,2')).to.equal(true)
  })
  it('pillar：竖直单列', () => {
    const cells = generateBlueprint('pillar', { x: 5, y: 64, z: 5 }, { x: 5, y: 70, z: 5 })
    expect(cells).to.have.lengthOf(7)
    expect(cells.every(c => c.x === 5 && c.z === 5)).to.equal(true)
  })
  it('角点顺序无关（自动取 min/max）', () => {
    const a = generateBlueprint('floor', { x: 2, y: 1, z: 3 }, { x: 0, y: 1, z: 1 })
    const b = generateBlueprint('floor', { x: 0, y: 1, z: 1 }, { x: 2, y: 1, z: 3 })
    expect(a).to.deep.equal(b)
  })
  it('未知模板返回空', () => {
    expect(generateBlueprint('castle', { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })).to.deep.equal([])
  })
})

describe('build: checkBlueprint', () => {
  it('空蓝图不合法', () => {
    expect(checkBlueprint([]).ok).to.equal(false)
  })
  it('超上限不合法并报数量', () => {
    const big = Array.from({ length: 600 }, (_, i) => ({ x: i, y: 0, z: 0 }))
    const r = checkBlueprint(big, 512)
    expect(r.ok).to.equal(false)
    expect(r.reason).to.include('600')
  })
  it('规模内合法', () => {
    expect(checkBlueprint([{ x: 0, y: 0, z: 0 }]).ok).to.equal(true)
  })
})
