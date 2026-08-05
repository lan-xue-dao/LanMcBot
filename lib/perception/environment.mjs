import * as bot from '../bot.mjs'

export function getNearbyEntities(radius = 16) {
  const b = bot.getBot()
  if (!b?.entities) return []

  return Object.values(b.entities)
    .filter(e => e !== b.entity)
    .filter(e => {
      const dist = e.position.distanceTo(b.entity.position)
      return dist <= radius
    })
    .map(e => ({
      id: e.id,
      name: e.name || e.username || 'unknown',
      type: e.type,
      position: {
        x: e.position.x.toFixed(1),
        y: e.position.y.toFixed(1),
        z: e.position.z.toFixed(1)
      },
      distance: e.position.distanceTo(b.entity.position).toFixed(1)
    }))
}

export function getNearbyPlayers(radius = 16) {
  const b = bot.getBot()
  if (!b?.players) return []

  return Object.values(b.players)
    .filter(p => p.username !== b.username)
    .filter(p => {
      if (!p.entity) return false
      const dist = p.entity.position.distanceTo(b.entity.position)
      return dist <= radius
    })
    .map(p => ({
      name: p.username,
      ping: p.ping,
      distance: p.entity.position.distanceTo(b.entity.position).toFixed(1)
    }))
}

export function getSurroundingBlocks(radius = 4) {
  const b = bot.getBot()
  if (!b?.entity?.position) return []

  const pos = b.entity.position
  const blocks = []

  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) {
      for (let z = -radius; z <= radius; z++) {
        const block = b.blockAt(pos.offset(x, y, z))
        if (block && block.name !== 'air') {
          blocks.push({
            name: block.name,
            position: { x: block.position.x, y: block.position.y, z: block.position.z }
          })
        }
      }
    }
  }

  return blocks
}

export function getNearestBlock(blockName, radius = 16) {
  const b = bot.getBot()
  if (!b?.findBlock) return null

  const blocks = b.findBlocks({
    matching: (block) => block.name === blockName,
    maxDistance: radius,
    count: 1
  })

  if (blocks.length === 0) return null

  const block = b.blockAt(blocks[0])
  return block ? {
    name: block.name,
    position: block.position
  } : null
}

export function getDangerLevel() {
  const b = bot.getBot()
  if (!b?.entity) return { level: 0, threats: [] }

  const threats = []
  const health = b.health || 20
  const food = b.food || 20

  if (health < 6) threats.push({ type: 'low_health', value: health })
  if (food < 6) threats.push({ type: 'low_food', value: food })

  const entities = getNearbyEntities(8)
  const hostileMobs = entities.filter(e =>
    ['zombie', 'skeleton', 'spider', 'creeper', 'enderman'].includes(e.name)
  )

  if (hostileMobs.length > 0) {
    threats.push({ type: 'hostile_mobs', count: hostileMobs.length })
  }

  const players = getNearbyPlayers(8)
  if (players.length > 0) {
    threats.push({ type: 'nearby_players', count: players.length })
  }

  let level = 0
  if (health < 6) level += 3
  else if (health < 12) level += 1
  if (food < 6) level += 2
  if (hostileMobs.length > 0) level += hostileMobs.length

  return { level: Math.min(level, 10), threats }
}
