import { selectionContext } from '../src/context'

describe('selectionContext', () => {
  it('reads the sentence across inline markup', () => {
    document.body.innerHTML = '<div><p id="p">毎日<strong>日本語</strong>を勉強する。</p><p>別の段落。</p></div>'
    const strong = document.querySelector('strong')!.firstChild as Text
    const range = document.createRange()
    range.setStart(strong, 0)
    range.setEnd(strong, 3)
    expect(selectionContext(range)).toEqual({ text: '毎日日本語を勉強する。', start: 2, end: 5 })
  })

  it('clamps a selection that runs past its block', () => {
    document.body.innerHTML = '<p id="a">一つ目。</p><p id="b">二つ目。</p>'
    const a = document.getElementById('a')!.firstChild as Text
    const b = document.getElementById('b')!.firstChild as Text
    const range = document.createRange()
    range.setStart(a, 2)
    range.setEnd(b, 2)
    const ctx = selectionContext(range)
    expect(ctx.text).toBe('一つ目。')
    expect(ctx.end).toBeLessThanOrEqual(ctx.text.length)
  })
})
