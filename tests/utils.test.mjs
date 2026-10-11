import { expect } from 'chai'
import { createWorld } from '../lib/nav/world.mjs'
import { groundAt, bodyClearAt, blockInfo } from '../lib/nav/world.mjs'

describe('nav/world.mjs', () => {
  describe('blockInfo', () => {
    it('should identify lava as liquid', () => {
      const block = { name: 'lava', _properties: {} }
      const info = blockInfo(block)
      expect(info.liquid).to.be.true
    })

    it('should identify water as liquid', () => {
      const block = { name: 'water', _properties: {} }
      const info = blockInfo(block)
      expect(info.liquid).to.be.true
    })

    it('should identify fence as fence', () => {
      const block = { name: 'oak_fence', _properties: {} }
      const info = blockInfo(block)
      expect(info.fence).to.be.true
    })

    it('should identify wood door as openable', () => {
      const block = { name: 'oak_door', _properties: { open: false } }
      const info = blockInfo(block)
      expect(info.openable).to.be.true
      expect(info.needsOpen).to.be.true
    })

    it('should identify iron door as openable but needs no opening', () => {
      const block = { name: 'iron_door', _properties: { open: false } }
      const info = blockInfo(block)
      expect(info.openable).to.be.true
      expect(info.needsOpen).to.be.false
      expect(info.iron).to.be.true
    })

    it('should identify trapdoor as penetrable', () => {
      const block = { name: 'oak_trapdoor', _properties: {} }
      const info = blockInfo(block)
      expect(info.penetrable).to.be.true
    })

    it('should identify button as penetrable', () => {
      const block = { name: 'stone_button', _properties: {} }
      const info = blockInfo(block)
      expect(info.penetrable).to.be.true
    })

    it('should identify ladder as climbable', () => {
      const block = { name: 'ladder', _properties: {} }
      const info = blockInfo(block)
      expect(info.climbable).to.be.true
    })

    it('should identify vine as climbable', () => {
      const block = { name: 'vine', _properties: {} }
      const info = blockInfo(block)
      expect(info.climbable).to.be.true
    })

    it('should identify sign as penetrable but not openable or standable', () => {
      const block = { name: 'oak_sign', _properties: {} }
      const info = blockInfo(block)
      expect(info.penetrable).to.be.true
      expect(info.openable).to.be.false
      expect(info.standable).to.be.false
    })

    it('should identify standing slab as standable', () => {
      const block = { name: 'stone', _properties: {}, shapes: [[0, 0, 0, 1, 0.875]] }
      const info = blockInfo(block)
      expect(info.standable).to.be.true
    })

    it('should identify wall as not standable', () => {
      const block = { name: 'stone', _properties: {} }
      const info = blockInfo(block)
      expect(info.standable).to.be.false
    })

    it('should identify fire as avoid', () => {
      const block = { name: 'fire', _properties: {} }
      const info = blockInfo(block)
      expect(info.avoid).to.be.true
    })

    it('should identify cobweb as avoid', () => {
      const block = { name: 'cobweb', _properties: {} }
      const info = blockInfo(block)
      expect(info.avoid).to.be.true
    })
  })

  describe('groundAt', () => {
    it('should find ground surface', () => {
      const world = createWorld((pos) => {
        if (pos.x === 0 && pos.y === 1 && pos.z === 0) {
          return { name: 'stone', _properties: {} }
        }
        return null
      })

      const ground = groundAt(world, 0, 0, 10, -64)
      expect(ground).to.exist
      expect(ground.feetY).to.equal(2)  // stone 在 y=1，feetY 是 y+1
      expect(ground.cellY).to.equal(1)
    })

    it('should return null if no ground found', () => {
      const world = createWorld((pos) => null)

      const ground = groundAt(world, 0, 0, 100, -64)
      expect(ground).to.be.null
    })

    it('should respect max search range', () => {
      const world = createWorld((pos) => {
        if (pos.y === 100) return { name: 'bedrock', _properties: {} }
        return null
      })

      const ground = groundAt(world, 0, 0, 50, -64)
      expect(ground).to.be.null
    })
  })

  describe('bodyClearAt', () => {
    it('should allow moving through air', () => {
      const world = createWorld((pos) => null)
      const result = bodyClearAt(world, 0, 0, 0, false)
      expect(result).to.be.true
    })

    it('should allow moving through water', () => {
      const world = createWorld((pos) => {
        if (pos.y === 0) return { name: 'water', _properties: {} }
        return null
      })
      const result = bodyClearAt(world, 0, 0, 0, false)
      expect(result).to.be.true
    })

    it('should deny moving through lava', () => {
      const world = createWorld((pos) => {
        if (pos.y === 0) return { name: 'lava', _properties: {} }
        return null
      })
      const result = bodyClearAt(world, 0, 0, 0, false)
      expect(result).to.be.false
    })

    it('should deny moving through fire', () => {
      const world = createWorld((pos) => {
        if (pos.y === 0) return { name: 'fire', _properties: {} }
        return null
      })
      const result = bodyClearAt(world, 0, 0, 0, false)
      expect(result).to.be.false
    })

    it('should deny moving through cobweb', () => {
      const world = createWorld((pos) => {
        if (pos.y === 0) return { name: 'cobweb', _properties: {} }
        return null
      })
      const result = bodyClearAt(world, 0, 0, 0, false)
      expect(result).to.be.false
    })

    it('should deny moving through solid block', () => {
      const world = createWorld((pos) => {
        if (pos.y === 0) return { name: 'stone', _properties: {} }
        return null
      })
      const result = bodyClearAt(world, 0, 0, 0, false)
      expect(result).to.be.false
    })

    it('should allow jump clearance through air', () => {
      const world = createWorld((pos) => null)
      const result = bodyClearAt(world, 0, 0, 0, true)
      expect(result).to.be.true
    })

    it('should deny jump clearance through lava', () => {
      const world = createWorld((pos) => {
        if (pos.y === 1) return { name: 'lava', _properties: {} }
        return null
      })
      const result = bodyClearAt(world, 0, 0, 0, true)
      expect(result).to.be.false
    })
  })

  describe('createWorld', () => {
    it('should create world with custom minY', () => {
      const world = createWorld((pos) => null, -128, 96)
      expect(world.minY).to.equal(-128)
    })

    it('should cache block info', () => {
      const world = createWorld((pos) => {
        if (pos.x === 0 && pos.y === 1 && pos.z === 0) {
          return { name: 'stone', _properties: {} }
        }
        return null
      })

      const cacheSize1 = world.getCacheSize()
      world.getCell(0, 1, 0)
      const cacheSize2 = world.getCacheSize()
      expect(cacheSize2).to.equal(cacheSize1)
    })

    it('should clear cache', () => {
      const world = createWorld((pos) => null)

      world.getCell(0, 1, 0)
      world.getCell(0, 2, 0)

      expect(world.getCacheSize()).to.be.greaterThan(0)

      world.clearCache()
      expect(world.getCacheSize()).to.equal(0)
    })
  })
})
