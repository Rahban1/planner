import { and, eq, gt } from 'drizzle-orm'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { db, runtimeEnv as cloudflareEnv, schema } from '#/db/index'
import type { User } from '#/db/schema'

export type AuthProvider = 'google' | 'github'
type UserProvider = AuthProvider | 'cloudflare'

type AuthEnv = Env & {
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
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
const OAUTH_STATE_COOKIE = 'planner_oauth_state'
const SESSION_MAX_AGE = 60 * 60 * 24 * 30
const OAUTH_STATE_MAX_AGE = 60 * 10

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

function callbackUrl(request: Request, provider: AuthProvider) {
  const url = new URL(request.url)
  url.pathname = `/api/auth/callback/${provider}`
  url.search = ''
  return url.toString()
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

function providerCredentials(provider: AuthProvider): {
  clientId: string
  clientSecret: string
} {
  const currentEnv = runtimeEnv()
  const credentials =
    provider === 'google'
      ? {
          clientId: currentEnv.GOOGLE_CLIENT_ID,
          clientSecret: currentEnv.GOOGLE_CLIENT_SECRET,
        }
      : {
          clientId: currentEnv.GITHUB_CLIENT_ID,
          clientSecret: currentEnv.GITHUB_CLIENT_SECRET,
        }

  if (!credentials.clientId || !credentials.clientSecret) {
    throw new Error(`${provider} OAuth is not configured`)
  }

  return {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  }
}

export function providerCredentialsConfigured(provider: AuthProvider) {
  const currentEnv = runtimeEnv()
  return provider === 'google'
    ? Boolean(currentEnv.GOOGLE_CLIENT_ID && currentEnv.GOOGLE_CLIENT_SECRET)
    : Boolean(currentEnv.GITHUB_CLIENT_ID && currentEnv.GITHUB_CLIENT_SECRET)
}

function randomBase64Url(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

async function codeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function oauthStateCookie(request: Request, value: string, maxAge: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
}

export function clearOAuthStateCookie(request: Request) {
  return oauthStateCookie(request, '', 0)
}

export async function startOAuth(
  request: Request,
  provider: AuthProvider,
  redirectPath: string | null,
) {
  const { clientId } = providerCredentials(provider)
  const state = randomBase64Url()
  const verifier = randomBase64Url()
  const challenge = await codeChallenge(verifier)
  const now = Date.now()
  const safeRedirect = sanitizeRedirect(redirectPath)

  await db.insert(schema.oauthStates).values({
    state,
    provider,
    codeVerifier: verifier,
    redirectPath: safeRedirect,
    expiresAt: now + OAUTH_STATE_MAX_AGE * 1000,
    createdAt: now,
  })

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl(request, provider),
    response_type: 'code',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  let response: Response
  if (provider === 'google') {
    params.set('scope', 'openid email profile')
    params.set('access_type', 'online')
    response = new Response(null, {
      status: 302,
      headers: {
        Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      },
    })
  } else {
    params.set('scope', 'read:user user:email')
    response = new Response(null, {
      status: 302,
      headers: {
        Location: `https://github.com/login/oauth/authorize?${params}`,
      },
    })
  }

  response.headers.set(
    'Set-Cookie',
    oauthStateCookie(request, state, OAUTH_STATE_MAX_AGE),
  )
  return response
}

async function exchangeCode(
  request: Request,
  provider: AuthProvider,
  code: string,
  verifier: string,
): Promise<ProviderProfile> {
  const { clientId, clientSecret } = providerCredentials(provider)

  if (provider === 'google') {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl(request, provider),
      }),
    })
    if (!tokenResponse.ok) throw new Error('Google token exchange failed')
    const token = (await tokenResponse.json()) as { access_token?: string }
    if (!token.access_token)
      throw new Error('Google did not return an access token')

    const profileResponse = await fetch(
      'https://openidconnect.googleapis.com/v1/userinfo',
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
      },
    )
    if (!profileResponse.ok) throw new Error('Google profile lookup failed')
    const profile = (await profileResponse.json()) as {
      sub?: string
      email?: string
      email_verified?: boolean
      name?: string
      picture?: string
    }
    if (!profile.sub || !profile.email || profile.email_verified !== true) {
      throw new Error('Google did not return a verified email address')
    }
    return {
      id: profile.sub,
      email: profile.email.toLowerCase().trim(),
      name: profile.name ?? null,
      avatarUrl: profile.picture ?? null,
    }
  }

  const tokenResponse = await fetch(
    'https://github.com/login/oauth/access_token',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: callbackUrl(request, provider),
      }),
    },
  )
  if (!tokenResponse.ok) throw new Error('GitHub token exchange failed')
  const token = (await tokenResponse.json()) as { access_token?: string }
  if (!token.access_token)
    throw new Error('GitHub did not return an access token')

  const profileResponse = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token.access_token}`,
      'User-Agent': 'Planner',
    },
  })
  if (!profileResponse.ok) throw new Error('GitHub profile lookup failed')
  const profile = (await profileResponse.json()) as {
    id?: number
    login?: string
    name?: string | null
    email?: string | null
    avatar_url?: string
  }
  if (!profile.id) throw new Error('GitHub did not return an account id')

  let email = profile.email
  if (!email) {
    const emailsResponse = await fetch('https://api.github.com/user/emails', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token.access_token}`,
        'User-Agent': 'Planner',
      },
    })
    if (emailsResponse.ok) {
      const emails = (await emailsResponse.json()) as Array<{
        email?: string
        primary?: boolean
        verified?: boolean
      }>
      email =
        emails.find((item) => item.primary && item.verified)?.email ??
        emails.find((item) => item.verified)?.email ??
        null
    }
  }
  if (!email) throw new Error('GitHub did not return a verified email address')

  return {
    id: String(profile.id),
    email: email.toLowerCase().trim(),
    name: profile.name ?? profile.login ?? null,
    avatarUrl: profile.avatar_url ?? null,
  }
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

export async function completeOAuth(
  request: Request,
  provider: AuthProvider,
  code: string,
  state: string,
) {
  const browserState = cookieValue(
    request.headers.get('cookie'),
    OAUTH_STATE_COOKIE,
  )
  if (!browserState || browserState !== state) {
    throw new Error(
      'This sign-in attempt did not start in this browser. Please try again.',
    )
  }

  const [oauthState] = await db
    .select()
    .from(schema.oauthStates)
    .where(
      and(
        eq(schema.oauthStates.state, state),
        eq(schema.oauthStates.provider, provider),
        gt(schema.oauthStates.expiresAt, Date.now()),
      ),
    )
  if (!oauthState)
    throw new Error('That sign-in attempt expired. Please try again.')

  await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, state))
  const profile = await exchangeCode(
    request,
    provider,
    code,
    oauthState.codeVerifier,
  )
  const userId = await findOrCreateUser(provider, profile)
  const response = await createSessionResponse(
    request,
    userId,
    oauthState.redirectPath,
  )
  response.headers.append('Set-Cookie', clearOAuthStateCookie(request))
  return response
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
