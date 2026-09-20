import { drizzle } from 'drizzle-orm/d1'
import { env } from '#/server/runtime'
import * as schema from './schema'

export const db = drizzle(env.DB, { schema })
export const runtimeEnv = env

export { schema }
