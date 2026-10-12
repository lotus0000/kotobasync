import { installKeyGuard } from './guard'

// Content scripts of one extension share an isolated world; content.ts installs the real close handler.
const hooks = globalThis as typeof globalThis & { __kotobaEscape?: () => void }
installKeyGuard(window, () => hooks.__kotobaEscape?.())
