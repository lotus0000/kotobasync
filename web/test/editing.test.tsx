import { createWord, type WordPayload } from '@kotoba/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from '../src/App'
import { jsonResponse, makeClient, routes } from './helpers'

describe('adding and editing words', () => {
  it('adds a word manually, lists it and queues it for sync', async () => {
    const client = makeClient()
    render(<App client={client} />)
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    fireEvent.change(await screen.findByLabelText('表记'), { target: { value: '勉強' } })
    fireEvent.change(screen.getByLabelText('原句'), { target: { value: '毎日勉強する。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('勉強')).toBeTruthy()
    const queued = await client.db.outbox.toArray()
    expect(queued).toHaveLength(1)
    expect((queued[0].payload as WordPayload).source).toBe('manual')
    expect((queued[0].payload as WordPayload).user_edited).toEqual(['surface'])
  })

  it('refuses to add a blank word', async () => {
    const client = makeClient()
    render(<App client={client} />)
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    fireEvent.click(await screen.findByRole('button', { name: '保存' }))
    expect(await screen.findByText('请输入表记')).toBeTruthy()
    expect(await client.db.words.count()).toBe(0)
  })

  it('edits a word and marks the changed field as user-edited', async () => {
    const client = makeClient()
    await createWord(client.db, { surface: '猫', reading: 'ねこ', source: 'chatgpt', user_edited: [] }, { now: 1, id: 'w1' })
    render(<App client={client} />)
    fireEvent.click(await screen.findByText('猫'))
    fireEvent.change(await screen.findByLabelText('中文'), { target: { value: '猫咪' } })
    fireEvent.click(screen.getByRole('radio', { name: '3' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(async () => {
      const w = await client.db.words.get('w1')
      expect(w).toMatchObject({ meaning_zh: '猫咪', familiarity: 3, user_edited: ['meaning_zh'] })
    })
  })

  it('saves only what the user changed, keeping fields filled while the editor was open', async () => {
    const client = makeClient()
    await createWord(client.db, { surface: '食べる', source: 'chatgpt' }, { now: 1, id: 'w1' })
    render(<App client={client} />)
    fireEvent.click(await screen.findByText('食べる'))
    await screen.findByLabelText('中文')
    await client.db.words.update('w1', { reading: 'たべる', meaning_zh: '吃', enrich_status: 'done' }) // a pull lands
    fireEvent.click(screen.getByRole('radio', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(async () => {
      const w = await client.db.words.get('w1')
      expect(w).toMatchObject({ reading: 'たべる', meaning_zh: '吃', familiarity: 2 })
      expect(w?.user_edited).not.toContain('reading')
    })
  })

  it('deletes only after confirmation', async () => {
    const client = makeClient()
    await createWord(client.db, { surface: '猫', source: 'manual' }, { now: 1, id: 'w1' })
    render(<App client={client} />)
    fireEvent.click(await screen.findByText('猫'))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    expect(await client.db.words.get('w1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(screen.queryByText('猫')).toBeNull())
    expect(await client.db.words.get('w1')).toBeUndefined()
  })

  it('offers re-enrichment for failed words and reports offline errors', async () => {
    const client = makeClient(routes({ 'POST /api/words/w1/enrich': () => jsonResponse(500, { detail: 'boom' }) }))
    await createWord(client.db, { surface: '謎', source: 'manual' }, { now: 1, id: 'w1' })
    await client.db.words.update('w1', { enrich_status: 'failed' })
    render(<App client={client} />)
    fireEvent.click(await screen.findByText('謎'))
    fireEvent.click(await screen.findByRole('button', { name: '重新补全' }))
    expect(await screen.findByText(/需要联网并登录/)).toBeTruthy()
  })
})
