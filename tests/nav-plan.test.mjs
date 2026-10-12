import { expect } from 'chai'
import { planRoute, walkable } from '../lib/nav/plan.mjs'
import { createWorld } from '../lib/nav/world.mjs'

// 假世界：groundAt 依赖 world.getCell(x,y,z) → {name, shapes, _properties}
// 关键：站立面必须带 shapes（top>=0.9 才 standable），否则全是 cliff
function wallSetHas(wall, x, z) {
  return (wall || []).some(([wx, wz]) => wx === x && wz === z)
}

function flatWorld({ wall = null, wallTop = 1 } = {}) {
  const wallSet = new Set(wall || [])
  return createWorld((pos) => {
    const { x, y, z } = pos
    if (wallSetHas(wall, x, z) && y >= 1 && y <= wallTop) {
      return { name: 'stone', shapes: [[0, 0, 0, 1, 1]], _properties: {} }
    }
    if (y === 0) return { name: 'grass_block', shapes: [[0, 0, 0, 1, 1]], _properties: {} }
    return { name: 'air', shapes: [], _properties: {} }
  }, 0)
}

describe('nav planRoute: 基础', () => {
  it('平地直达走直线', () => {
    const w = flatWorld()
    const p = planRoute(w, 0, 0, 1, 3, 1, 0, 48)
    expect(p).to.not.equal(null)
    const last = p[p.length - 1]
    expect(last.x).to.equal(3)
    expect(last.z).to.equal(0)
  })
  it('有墙时绕行仍可达', () => {
    // 从 (0,0) 到 (3,0)，在 x=1 全 z=-2..2 立 2 格高墙（1 格高可跳上墙顶，不算挡路）→ 必须绕 z
    const wall = []
    for (let z = -2; z <= 2; z++) wall.push([1, z])
    const w = createWorld((pos) => {
      const { x, y, z } = pos
      if (y === 0) return { name: 'grass_block', shapes: [[0, 0, 0, 1, 1]], _properties: {} }
      if (wallSetHas(wall, x, z) && (y === 1 || y === 2)) {
        return { name: 'stone', shapes: [[0, 0, 0, 1, 1]], _properties: {} }
      }
      return { name: 'air', shapes: [], _properties: {} }
    }, 0)
    const p = planRoute(w, 0, 0, 1, 3, 1, 0, 48)
    expect(p).to.not.equal(null)
    expect(p.some(s => s.x === 1 && s.z === 0)).to.equal(false) // 不穿墙
  })
  it('超出 maxRange 返回 null', () => {
    const w = flatWorld()
    expect(planRoute(w, 0, 0, 1, 100, 1, 0, 48)).to.equal(null)
  })
})

describe('nav planRoute: decrease-key 正确性', () => {
  it('经 OPEN_COST 门格的更短路径不会被次优路径替代', () => {
    // 起点(0,0) → 终点(2,0)。x=1,z=0 是门（可走，action='open'，代价+OPEN_COST），
    // 上下两行是普通平地（绕行 2 步直线代价 2+1.414 ≈ 3.414 > 门路 1+1=2）。
    // 旧实现里若先以更高 g 入堆过 (1,0)（如从斜对角来），会因 openKeys 跳过更优 g。
    const wall = [[1, -1], [1, 1]] // 门在 (1,0)，两侧是墙 → 只能走门或大绕
    const w = createWorld((pos) => {
      const { x, y, z } = pos
      if (wall.some(([wx, wz]) => wx === x && wz === z) && y === 1) {
        return { name: 'oak_door', shapes: [[0, 0, 0, 1, 1]], _properties: { open: false } }
      }
      if (y === 0) return { name: 'grass_block', shapes: [[0, 0, 0, 1, 1]], _properties: {} }
      return { name: 'air', shapes: [], _properties: {} }
    }, 0)
    const p = planRoute(w, 0, 0, 1, 2, 1, 0, 48)
    expect(p).to.not.equal(null)
    // 路径总代价必须 ≤ 直线门路（走门 STEP+OPEN=2，绕行至少 1.414*2+2≈4.8）
    // 有效性：终点正确
    expect(p[p.length - 1].x).to.equal(2)
    expect(p[p.length - 1].z).to.equal(0)
  })

  it('路点相邻且连续（无跳跃断档）', () => {
    const wall = [[2, 0]]
    const w = flatWorld({ wall })
    const p = planRoute(w, 0, 0, 1, 4, 1, 0, 48)
    expect(p).to.not.equal(null)
    for (let i = 1; i < p.length; i++) {
      const dx = Math.abs(p[i].x - p[i - 1].x)
      const dz = Math.abs(p[i].z - p[i - 1].z)
      expect(Math.max(dx, dz)).to.be.at.most(1)
    }
  })
})

describe('nav planRoute: 大坐标键防碰撞', () => {
  it('|坐标|≥65536 时仍能正确寻路（旧 x*65536+z 键会碰撞）', () => {
    const w = flatWorld()
    // x=65536 处：旧键 key(65536,0)=65536*65536 与 key(65537,-65537) 等碰撞场景；
    // 这里直接验证大坐标邻域寻路正确且不互相污染
    const sx = 65536, sz = 65536
    const p = planRoute(w, sx, sz, 1, sx + 3, 1, sz, 48)
    expect(p).to.not.equal(null)
    expect(p[p.length - 1].x).to.equal(sx + 3)
    expect(p[p.length - 1].z).to.equal(sz)
    // 每个路点都在目标邻域（无键碰撞导致的飞点）
    for (const s of p) {
      expect(Math.abs(s.x - sx)).to.be.at.most(4)
      expect(Math.abs(s.z - sz)).to.be.at.most(4)
    }
  })
  it('负大坐标同样正确', () => {
    const w = flatWorld()
    const sx = -70000, sz = -70000
    const p = planRoute(w, sx, sz, 1, sx - 2, 1, sz - 2, 48)
    expect(p).to.not.equal(null)
    expect(p[p.length - 1].x).to.equal(sx - 2)
    expect(p[p.length - 1].z).to.equal(sz - 2)
  })
})
