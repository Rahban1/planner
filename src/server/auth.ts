import { getRequest } from '@tanstack/react-start/server'
import { and, eq, gt } from 'drizzle-orm'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { db, runtimeEnv as cloudflareEnv, schema } from '#/db/index'
import type { User } from '#/db/schema'

type UserProvider = 'oauth2_proxy' | 'cloudflare'

type AuthEnv = Env & {
  AUTH_MODE?: string
  CF_ACCESS_TEAM_DOMAIN?: string
  CF_ACCESS_AUDIENCE?: string
}

type ProviderProfile = {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
}

const SESSION_COOKIE = 'planner_session'
const SESSION_MAX_AGE = 60 * 60 * 24 * 30

function runtimeEnv() {
  return cloudflareEnv as AuthEnv
}

function accessConfig() {
  const currentEnv = runtimeEnv()
  const teamDomain = currentEnv.CF_ACCESS_TEAM_DOMAIN?.replace(/\/$/, '')
  const audience = currentEnv.CF_ACCESS_AUDIENCE
  if (!teamDomain || !audience) return null
  return { teamDomain, audience }
}

function cookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(/;\s*/)) {
    const separator = part.indexOf('=')
    if (separator !== -1 && part.slice(0, separator) === name) {
      return decodeURIComponent(part.slice(separator + 1))
    }
  }
  return null
}

export function sanitizeRedirect(value: string | null | undefined) {
  if (
    value?.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\')
  )
    return value
  return '/dashboard'
}

export function accessLoginUrl(request: Request, redirectPath: string | null) {
  const config = accessConfig()
  if (!config) return null

  const url = new URL(request.url)
  const safeRedirect = sanitizeRedirect(redirectPath)
  const callbackPath = `/api/auth/cloudflare/callback?redirect=${encodeURIComponent(safeRedirect)}`
  const loginUrl = new URL(
    `${config.teamDomain}/cdn-cgi/access/login/${url.host}`,
  )
  loginUrl.searchParams.set('kid', config.audience)
  loginUrl.searchParams.set('redirect_url', callbackPath)
  return loginUrl.toString()
}

async function findOrCreateUser(
  provider: UserProvider,
  profile: ProviderProfile,
) {
  const existingByProvider = await db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.provider, provider),
        eq(schema.users.providerAccountId, profile.id),
      ),
    )
  const existing = existingByProvider[0]
  const now = Date.now()

  if (existing) {
    await db
      .update(schema.users)
      .set({
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        updatedAt: now,
      })
      .where(eq(schema.users.id, existing.id))
    return existing.id
  }

  const existingByEmail = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, profile.email))
  const sameEmailUser = existingByEmail[0]
  if (sameEmailUser) {
    await db
      .update(schema.users)
      .set({
        provider,
        providerAccountId: profile.id,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        updatedAt: now,
      })
      .where(eq(schema.users.id, sameEmailUser.id))
    return sameEmailUser.id
  }

  const userId = crypto.randomUUID()
  await db.insert(schema.users).values({
    id: userId,
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    provider,
    providerAccountId: profile.id,
    createdAt: now,
    updatedAt: now,
  })
  return userId
}

function sessionCookie(request: Request, value: string, maxAge: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
}

export function clearSessionCookie(request: Request) {
  return sessionCookie(request, '', 0)
}

async function createSessionResponse(
  request: Request,
  userId: string,
  redirectPath: string,
) {
  const sessionId = crypto.randomUUID()
  const now = Date.now()
  await db.insert(schema.authSessions).values({
    id: sessionId,
    userId,
    expiresAt: now + SESSION_MAX_AGE * 1000,
    createdAt: now,
  })

  const response = new Response(null, {
    status: 302,
    headers: {
      Location: new URL(sanitizeRedirect(redirectPath), request.url).toString(),
    },
  })
  response.headers.set(
    'Set-Cookie',
    sessionCookie(request, sessionId, SESSION_MAX_AGE),
  )
  return response
}

export async function createLocalProofSession(request: Request) {
  const userId = await findOrCreateUser('oauth2_proxy', {
    id: 'proof@planner.local',
    email: 'proof@planner.local',
    name: 'Planner Proof',
    avatarUrl: null,
  })
  // The local proof route is available only on loopback in development.
  // Grant its fixed user access only to the three isolated seed projects.
  for (const projectId of ['p_app_a', 'p_app_b', 'p_app_c']) {
    await db
      .insert(schema.projectMembers)
      .values({
        id: `proof-member-${projectId}`,
        projectId,
        email: 'proof@planner.local',
        role: 'owner',
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
  }
  return createSessionResponse(request, userId, '/dashboard')
}

export async function completeSSOLogin(
  request: Request,
  redirectPath: string | null,
) {
  const isDev = import.meta.env.DEV

  let email = request.headers.get('x-forwarded-email')?.trim().toLowerCase()
  let username = request.headers.get('x-forwarded-preferred-username')

  if (!email && isDev) {
    const devUser = import.meta.env.VITE_DEV_SSO_USER
    if (devUser) {
      const normalizedId = devUser.toLowerCase().trim()
      email = normalizedId.includes('@')
        ? normalizedId
        : `${normalizedId}@ti.com`
      username = devUser
    }
  }

  if (!email) {
    throw new Error(
      isDev
        ? 'No x-forwarded-email header and VITE_DEV_SSO_USER is not set. Add it to .env.local.'
        : 'x-forwarded-email header is missing. Ensure the oauth2-proxy is configured correctly.',
    )
  }

  const userId = await findOrCreateUser('oauth2_proxy', {
    id: email,
    email,
    name: username ?? email,
    avatarUrl: null,
  })
  return createSessionResponse(request, userId, sanitizeRedirect(redirectPath))
}

export async function completeCloudflareAccessLogin(
  request: Request,
  redirectPath: string | null,
) {
  const config = accessConfig()
  if (!config) throw new Error('Cloudflare Access fallback is not configured')

  const token = request.headers.get('cf-access-jwt-assertion')
  if (!token)
    throw new Error('Cloudflare Access did not provide an identity token')

  const jwks = createRemoteJWKSet(
    new URL(`${config.teamDomain}/cdn-cgi/access/certs`),
  )
  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.teamDomain,
    audience: config.audience,
  })

  const email =
    typeof payload.email === 'string'
      ? payload.email.toLowerCase().trim()
      : null
  const subject = typeof payload.sub === 'string' ? payload.sub : null
  if (!email || !subject)
    throw new Error('Cloudflare Access identity is missing email or subject')

  const profile: ProviderProfile = {
    id: subject,
    email,
    name: typeof payload.name === 'string' ? payload.name : null,
    avatarUrl: null,
  }
  const userId = await findOrCreateUser('cloudflare', profile)
  return createSessionResponse(request, userId, sanitizeRedirect(redirectPath))
}

export async function getUserFromCookie(
  cookieHeader: string | null,
): Promise<User | null> {
  if (runtimeEnv().AUTH_MODE === 'oauth2_proxy') {
    const req = getRequest()
    let email = req.headers.get('x-forwarded-email')?.trim().toLowerCase()

    if (!email && import.meta.env.DEV) {
      const devUser = import.meta.env.VITE_DEV_SSO_USER
      if (devUser) {
        const normalizedId = devUser.toLowerCase().trim()
        email = normalizedId.includes('@')
          ? normalizedId
          : `${normalizedId}@ti.com`
      }
    }

    if (!email || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) return null
    const [existing] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
    if (existing) return existing
    const now = Date.now()
    await db
      .insert(schema.users)
      .values({
        id: crypto.randomUUID(),
        email,
        provider: 'oauth2_proxy',
        providerAccountId: email,
        name:
          req.headers.get('x-forwarded-preferred-username') ??
          import.meta.env.VITE_DEV_SSO_USER ??
          email,
        avatarUrl: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
    return user ?? null
  }

  const sessionId = cookieValue(cookieHeader, SESSION_COOKIE)
  if (!sessionId) return null

  const rows = await db
    .select({ user: schema.users })
    .from(schema.authSessions)
    .innerJoin(schema.users, eq(schema.authSessions.userId, schema.users.id))
    .where(
      and(
        eq(schema.authSessions.id, sessionId),
        gt(schema.authSessions.expiresAt, Date.now()),
      ),
    )
  return rows[0]?.user ?? null
}
