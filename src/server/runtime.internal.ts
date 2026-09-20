import { resolve } from 'node:path'
import { fileBucket, openDatabase } from '../../deploy/node/storage.mjs'

const directory = process.env.PLANNER_DATA_DIR ?? './data'
const database = openDatabase(
  resolve(directory, 'planner.sqlite'),
  resolve(process.env.PLANNER_MIGRATIONS_DIR ?? 'drizzle/migrations'),
)

// The adapter supports the D1 and R2 operations used by this application.
export const env = {
  ...process.env,
  DB: database,
  ATTACHMENTS: fileBucket(resolve(directory, 'files')),
  TASK_CHAT_ROOMS: undefined,
  GITHUB_ACTIONS_DISPATCH_TOKEN: undefined,
} as unknown as Env
