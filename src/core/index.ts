// Public barrel for src/core. Internal helpers are not re-exported here.

export type { CoreConfig } from './config'
export { defaultConfig } from './config'

export type {
  SpeechEvent,
  SpeakingState,
  LiveSnapshot,
  SessionSummary,
} from './types'

export type { SessionState } from './session'
export { createSession, ingest } from './session'
