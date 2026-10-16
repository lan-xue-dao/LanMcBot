// 触发引擎（P1 聊天指令与自动化脚本/触发引擎核心）：
//   规则解析/匹配写成「零依赖纯函数」+ 注入式 engine（分发事件→动作）。
//   规则来源：玩家聊天、bot 事件（health/死亡/玩家进出等），动作交给调用方执行。

/**
 * 纯函数：解析规则文本。
 * 格式：`when <事件> <匹配式> then <动作> [参数...]`
 *   - 事件：chat / health / death / join / leave / spawn（任意标识符）
 *   - 匹配式：`/regex/flags` 正则，或 contains:文本，或 exact:文本，或 * （任意）
 *   - 动作：say / cmd / event 等（引擎不解释，原样下发）
 * @returns {{ok:boolean, rule?:object, reason?:string}}
 *   rule = { event, kind:'regex'|'contains'|'exact'|'any', pattern, action, args }
 */
export function parseTrigger(text) {
  const m = String(text || '').trim().match(/^when\s+(\S+)\s+(\S+(?:\s+(?!then\s).)*?)?\s*then\s+(\S+)(?:\s+(.*))?$/i)
  if (!m) return { ok: false, reason: '格式: when <事件> <匹配式> then <动作> [参数]' }
  const [, event, rawPat = '*', action, args = ''] = m
  let kind = 'any'
  let pattern = ''
  const p = (rawPat || '*').trim()
  const re = p.match(/^\/(.*)\/([gimsuy]*)$/s)
  if (re) {
    kind = 'regex'
    try { pattern = new RegExp(re[1], re[2]) } catch (e) { return { ok: false, reason: `正则无效: ${e.message}` } }
  } else if (p.startsWith('contains:')) {
    kind = 'contains'; pattern = p.slice(9)
  } else if (p.startsWith('exact:')) {
    kind = 'exact'; pattern = p.slice(6)
  } else if (p === '*') {
    kind = 'any'
  } else {
    return { ok: false, reason: '匹配式须为 /正则/、contains:文本、exact:文本 或 *' }
  }
  return { ok: true, rule: { event: event.toLowerCase(), kind, pattern, action: action.toLowerCase(), args: args.trim() } }
}

/**
 * 纯函数：事件是否命中规则。
 * @param {object} rule parseTrigger 产出的 rule
 * @param {string} event 事件名
 * @param {string} text 事件文本载荷（无文本事件传 ''）
 * @returns {boolean}
 */
export function matchesTrigger(rule, event, text = '') {
  if (!rule || rule.event !== String(event).toLowerCase()) return false
  const t = String(text ?? '')
  switch (rule.kind) {
    case 'any': return true
    case 'contains': return t.includes(rule.pattern)
    case 'exact': return t === rule.pattern
    case 'regex': try { return rule.pattern.test(t) } catch { return false }
    default: return false
  }
}

/**
 * 触发引擎：注册规则表，收到事件后按序匹配并回调动作。
 * 不含定时器/IO，测试可完全手动驱动。
 * @param {{onAction?:(rule:object, event:string, text:string)=>void, maxRules?:number}} o
 */
export function createTriggerEngine({ onAction, maxRules = 64 } = {}) {
  const rules = []

  function add(rule) {
    if (rules.length >= maxRules) return { ok: false, reason: `规则数已达上限 ${maxRules}` }
    rules.push(rule)
    return { ok: true, index: rules.length - 1 }
  }

  function remove(index) {
    if (index < 0 || index >= rules.length) return { ok: false, reason: '规则不存在' }
    rules.splice(index, 1)
    return { ok: true }
  }

  function list() {
    return rules.map((r, i) => ({
      index: i,
      event: r.event,
      match: r.kind === 'any' ? '*' : r.kind === 'regex' ? `/${r.pattern.source}/${r.pattern.flags}` : `${r.kind}:${r.pattern}`,
      action: r.action,
      args: r.args
    }))
  }

  /**
   * 事件入口：返回命中的规则数（每条命中规则都回调 onAction）。
   * @param {string} event 事件名（chat/death/health/join/leave 等）
   * @param {string} text 事件文本（聊天内容、血量字符串、玩家名等）
   * @param {object} [ctx] 事件上下文（如 {username}，供动作插值 {player}）
   */
  function handleEvent(event, text = '', ctx = null) {
    let hits = 0
    for (const r of rules) {
      if (matchesTrigger(r, event, text)) {
        hits++
        if (onAction) {
          try { onAction(r, event, text, ctx) } catch { /* 动作异常不中断其它规则 */ }
        }
      }
    }
    return hits
  }

  function clear() { rules.length = 0 }

  return { add, remove, list, handleEvent, clear, count: () => rules.length, __rawRules: () => rules }
}

// ---------- 持久化（round 4）：规则存 rules.json，重启自动恢复 ----------

/**
 * 纯函数：规则 → 可 JSON 化对象（regex 拆 source/flags）。
 */
export function serializeRule(rule) {
  if (!rule) return null
  if (rule.kind === 'regex') {
    return { event: rule.event, kind: 'regex', source: rule.pattern.source, flags: rule.pattern.flags, action: rule.action, args: rule.args }
  }
  return { event: rule.event, kind: rule.kind, pattern: rule.pattern, action: rule.action, args: rule.args }
}

/**
 * 纯函数：JSON 对象 → 规则（regex 重组；非法条目返回 null）。
 */
export function deserializeRule(obj) {
  if (!obj || !obj.event || !obj.kind || !obj.action) return null
  if (obj.kind === 'regex') {
    try {
      return { event: String(obj.event), kind: 'regex', pattern: new RegExp(obj.source, obj.flags || ''), action: String(obj.action), args: String(obj.args || '') }
    } catch { return null }
  }
  if (!['contains', 'exact', 'any'].includes(obj.kind)) return null
  return { event: String(obj.event), kind: obj.kind, pattern: obj.pattern ?? '', action: String(obj.action), args: String(obj.args || '') }
}
