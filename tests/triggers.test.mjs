import { expect } from 'chai'
import { parseTrigger, matchesTrigger, createTriggerEngine } from '../lib/triggers.mjs'

describe('triggers: parseTrigger', () => {
  it('解析正则规则', () => {
    const r = parseTrigger('when chat /hello|hi/i then say 你好')
    expect(r.ok).to.equal(true)
    expect(r.rule.event).to.equal('chat')
    expect(r.rule.kind).to.equal('regex')
    expect(r.rule.action).to.equal('say')
    expect(r.rule.args).to.equal('你好')
  })
  it('解析 contains/exact/any', () => {
    expect(parseTrigger('when chat contains:签到 then cmd !sign').rule.kind).to.equal('contains')
    expect(parseTrigger('when chat exact:ping then say pong').rule.kind).to.equal('exact')
    expect(parseTrigger('when death * then event died').rule.kind).to.equal('any')
  })
  it('缺 then / 坏正则返回错误', () => {
    expect(parseTrigger('when chat /x/i say hi').ok).to.equal(false)
    expect(parseTrigger('when chat /[unclosed/ then say x').ok).to.equal(false)
  })
})

describe('triggers: matchesTrigger', () => {
  const r = parseTrigger('when chat /买|sell/i then say 收到').rule
  it('事件名不匹配不触发', () => {
    expect(matchesTrigger(r, 'death', '买')).to.equal(false)
  })
  it('正则命中', () => {
    expect(matchesTrigger(r, 'chat', '我想买点东西')).to.equal(true)
    expect(matchesTrigger(r, 'chat', 'hello')).to.equal(false)
  })
  it('exact/contains/any', () => {
    expect(matchesTrigger(parseTrigger('when chat exact:ping then say pong').rule, 'chat', 'ping')).to.equal(true)
    expect(matchesTrigger(parseTrigger('when chat exact:ping then say pong').rule, 'chat', 'ping!')).to.equal(false)
    expect(matchesTrigger(parseTrigger('when death * then event x').rule, 'death', '')).to.equal(true)
  })
})

describe('triggers: createTriggerEngine', () => {
  it('命中规则按序回调并返回命中数', () => {
    const fired = []
    const eng = createTriggerEngine({ onAction: (rule, ev, text) => fired.push([rule.action, ev, text]) })
    expect(eng.add(parseTrigger('when chat contains:买 then say 收到').rule).ok).to.equal(true)
    expect(eng.add(parseTrigger('when chat /help/i then cmd !help').rule).ok).to.equal(true)
    const hits = eng.handleEvent('chat', '我要买东西')
    expect(hits).to.equal(1)
    expect(fired).to.deep.equal([['say', 'chat', '我要买东西']])
    expect(eng.handleEvent('chat', 'HELP me').hits ?? eng.handleEvent('chat', 'HELP me')).to.equal(1)
    expect(eng.count()).to.equal(2)
  })
  it('动作异常不中断其它规则', () => {
    const fired = []
    const eng = createTriggerEngine({ onAction: (rule) => { if (rule.action === 'bad') throw new Error('x'); fired.push(rule.action) } })
    eng.add(parseTrigger('when chat * then bad').rule)
    eng.add(parseTrigger('when chat * then good').rule)
    expect(eng.handleEvent('chat', '')).to.equal(2)
    expect(fired).to.deep.equal(['good'])
  })
  it('remove/list/clear', () => {
    const eng = createTriggerEngine()
    eng.add(parseTrigger('when chat contains:a then say x').rule)
    eng.add(parseTrigger('when death * then event d').rule)
    expect(eng.list().length).to.equal(2)
    expect(eng.remove(0).ok).to.equal(true)
    expect(eng.remove(9).ok).to.equal(false)
    expect(eng.count()).to.equal(1)
    eng.clear()
    expect(eng.count()).to.equal(0)
  })
})
