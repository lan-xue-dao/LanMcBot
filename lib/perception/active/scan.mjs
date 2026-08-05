import * as bot from '../../bot.mjs'

export function scanEntities(radius = 8) {
  const b = bot.getBot()
  if (!b?.entities) return { success: false, error: '未连接' }

  const center = b.entity.position
  const entities = Object.values(b.entities)
    .filter(e => e !== b.entity)
    .filter(e => Math.abs(e.position.x - center.x) <= radius &&
                 Math.abs(e.position.y - center.y) <= radius &&
                 Math.abs(e.position.z - center.z) <= radius)
    .map(e => ({
      name: e.name || e.username || 'unknown',
      type: e.type,
      distance: e.position.distanceTo(center).toFixed(1)
    }))

  return { success: true, count: entities.length, entities }
}

export function scanPlayers(radius = 8) {
  const b = bot.getBot()
  if (!b?.players) return { success: false, error: '未连接' }

  const center = b.entity.position
  const players = Object.values(b.players)
    .filter(p => p.username !== b.username && p.entity)
    .filter(p => Math.abs(p.entity.position.x - center.x) <= radius &&
                 Math.abs(p.entity.position.y - center.y) <= radius &&
                 Math.abs(p.entity.position.z - center.z) <= radius)
    .map(p => ({
      name: p.username,
      ping: p.ping,
      distance: p.entity.position.distanceTo(center).toFixed(1)
    }))

  return { success: true, count: players.length, players }
}

export function scanBlocks(radius = 8) {
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

export function findBlock(blockName, radius = 8) {
  const b = bot.getBot()
  if (!b?.findBlock) return { success: false, error: '未连接' }

  const tryFind = (predicate) => b.findBlocks({
    matching: predicate,
    maxDistance: radius,
    count: 5
  })

  let blocks = tryFind(block => block.name === blockName)
  if (blocks.length === 0 && blockName.endsWith('bed')) {
    blocks = tryFind(block => block.name.endsWith('bed'))
  }

  const found = blocks.map(pos => {
    const block = b.blockAt(pos)
    return {
      position: { x: pos.x, y: pos.y, z: pos.z },
      distance: pos.distanceTo(b.entity.position).toFixed(1)
    }
  })

  return { success: true, count: found.length, blocks: found }
}

const HOSTILE_MOBS = ['zombie', 'skeleton', 'spider', 'creeper', 'enderman']

export function getDangerLevel() {
  const b = bot.getBot()
  if (!b?.entity) return { success: false, error: '未连接' }

  const threats = []
  const health = b.health || 20
  const food = b.food || 20

  if (health < 6) threats.push({ type: 'low_health', value: health })
  if (food < 6) threats.push({ type: 'low_food', value: food })

  const entities = Object.values(b.entities)
    .filter(e => e !== b.entity)
    .filter(e => e.position.distanceTo(b.entity.position) <= 8)

  const hostileMobs = entities.filter(e => HOSTILE_MOBS.includes(e.name))
  if (hostileMobs.length > 0) {
    threats.push({ type: 'hostile_mobs', count: hostileMobs.length })
  }

  let level = 0
  if (health < 6) level += 3
  else if (health < 12) level += 1
  if (food < 6) level += 2
  if (hostileMobs.length > 0) level += hostileMobs.length

  return { success: true, level: Math.min(level, 10), threats }
}
