import { createWord, setMeta } from '@kotoba/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from '../src/App'
import { makeClient, routes } from './helpers'

describe('App', () => {
  it('lists saved words and filters them by search', async () => {
    const client = makeClient()
    await createWord(client.db, { surface: '猫', reading: 'ねこ', meaning_zh: '猫咪', source: 'manual' }, { now: 1, id: 'a' })
    await createWord(client.db, { surface: '犬', reading: 'いぬ', meaning_zh: '狗', source: 'manual' }, { now: 2, id: 'b' })
    render(<App client={client} />)
    expect(await screen.findByText('猫')).toBeTruthy()
    expect(screen.getByText('犬')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('搜索'), { target: { value: 'ねこ' } })
    await waitFor(() => expect(screen.queryByText('犬')).toBeNull())
    expect(screen.getByText('猫')).toBeTruthy()
  })

  it('shows the empty state and the not-logged-in banner', async () => {
    render(<App client={makeClient()} />)
    expect(await screen.findByText(/还没有词/)).toBeTruthy()
    expect(await screen.findByText(/未登录/)).toBeTruthy()
  })

  it('shows the Access banner when the session expired', async () => {
    const expired = { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() } as unknown as Response
    const client = makeClient(routes({ 'GET /api/sync': () => expired }))
    await setMeta(client.db, 'token', 't')
    render(<App client={client} />)
    expect(await screen.findByText(/Access 登录已过期/)).toBeTruthy()
    // A plain reload would be answered by the service worker's cached app shell; /api/* bypasses it.
    expect(screen.getByRole('link', { name: '点此重新登录' }).getAttribute('href')).toBe('/api/relogin')
  })
})
