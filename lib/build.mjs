// 建造蓝图（P0-3 建造侧增强）：模板展开为坐标序列（纯函数、可单测），
// 运行期放置循环由 bot.mjs 调用 placeBlock 完成（逐格放置，失败跳过并计数）。

/**
 * 纯函数：展开蓝图模板为坐标序列。
 * @param {'wall'|'floor'|'box'|'pillar'} type 模板类型
 * @param {{x:number,y:number,z:number}} from 角点1（取整）
 * @param {{x:number,y:number,z:number}} to 角点2（取整，含）
 * @returns {Array<{x:number,y:number,z:number}>} 坐标序列（去重、按 y→z→x 稳定排序）
 */
export function generateBlueprint(type, from, to) {
  const ax = Math.floor(from.x), ay = Math.floor(from.y), az = Math.floor(from.z)
  const bx = Math.floor(to.x), by = Math.floor(to.y), bz = Math.floor(to.z)
  const minX = Math.min(ax, bx), maxX = Math.max(ax, bx)
  const minY = Math.min(ay, by), maxY = Math.max(ay, by)
  const minZ = Math.min(az, bz), maxZ = Math.max(az, bz)

  const cells = []
  const push = (x, y, z) => cells.push({ x, y, z })

  switch (type) {
    case 'wall': {
      // 竖直平面：沿较长主轴铺设，另一水平轴取 minZ/minX
      if (maxX - minX >= maxZ - minZ) {
        for (let y = minY; y <= maxY; y++)
          for (let x = minX; x <= maxX; x++)
            push(x, y, minZ)
      } else {
        for (let y = minY; y <= maxY; y++)
          for (let z = minZ; z <= maxZ; z++)
            push(minX, y, z)
      }
      break
    }
    case 'floor': {
      for (let z = minZ; z <= maxZ; z++)
        for (let x = minX; x <= maxX; x++)
          push(x, minY, z)
      break
    }
    case 'box': {
      // 空心长方体（仅外壳）
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          for (let z = minZ; z <= maxZ; z++) {
            const shell = x === minX || x === maxX || y === minY || y === maxY || z === minZ || z === maxZ
            if (shell) push(x, y, z)
          }
        }
      }
      break
    }
    case 'pillar': {
      const x = Math.min(ax, bx)
      const z = Math.min(az, bz)
      for (let y = minY; y <= maxY; y++) push(x, y, z)
      break
    }
    default:
      return []
  }

  // 去重（极端角点会重合）
  const seen = new Set()
  const out = []
  for (const c of cells) {
    const k = `${c.x},${c.y},${c.z}`
    if (!seen.has(k)) { seen.add(k); out.push(c) }
  }
  return out
}

/**
 * 纯函数：蓝图规模校验（防止误输入造成海量放置）。
 * @returns {{ok:boolean, count:number, reason?:string}}
 */
export function checkBlueprint(cells, maxCells = 512) {
  const count = (cells || []).length
  if (count === 0) return { ok: false, count, reason: '蓝图为空（检查模板与角点）' }
  if (count > maxCells) return { ok: false, count, reason: `蓝图过大（${count} > ${maxCells}）` }
  return { ok: true, count }
}
