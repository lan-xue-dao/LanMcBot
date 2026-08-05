import * as bot from '../../bot.mjs'

export function scanEntities(radius = 16) {
  const b = bot.getBot()
  if (!b?.entities) return { success: false, error: '未连接' }

  const entities = Object.values(b.entities)
    .filter(e => e !== b.entity)
    .filter(e => e.position.distanceTo(b.entity.position) <= radius)
    .map(e => ({
      name: e.name || e.username || 'unknown',
      type: e.type,
      distance: e.position.distanceTo(b.entity.position).toFixed(1)
    }))

  return { success: true, count: entities.length, entities }
}

export function scanPlayers(radius = 16) {
  const b = bot.getBot()
  if (!b?.players) return { success: false, error: '未连接' }

  const players = Object.values(b.players)
    .filter(p => p.username !== b.username && p.entity)
    .filter(p => p.entity.position.distanceTo(b.entity.position) <= radius)
    .map(p => ({
      name: p.username,
      ping: p.ping,
      distance: p.entity.position.distanceTo(b.entity.position).toFixed(1)
    }))

  return { success: true, count: players.length, players }
}

export function scanBlocks(radius = 4) {
  const b = bot.getBot()
  if (!b?.entity?.position) return { success: false, error: '未连接' }

  const pos = b.entity.position
  const blocks = {}

  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) {
      for (let z = -radius; z <= radius; z++) {
        const block = b.blockAt(pos.offset(x, y, z))
        if (block && block.name !== 'air') {
          blocks[block.name] = (blocks[block.name] || 0) + 1
        }
      }
    }
  }

  const sorted = Object.entries(blocks)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))

  return { success: true, blocks: sorted }
}

export function findBlock(blockName, radius = 16) {
  const b = bot.getBot()
  if (!b?.findBlock) return { success: false, error: '未连接' }

  const blocks = b.findBlocks({
    matching: (block) => block.name === blockName,
    maxDistance: radius,
    count: 5
  })

  const found = blocks.map(pos => {
    const block = b.blockAt(pos)
    return {
      position: { x: pos.x, y: pos.y, z: pos.z },
      distance: pos.distanceTo(b.entity.position).toFixed(1)
    }
  })

  return { success: true, count: found.length, blocks: found }
}
