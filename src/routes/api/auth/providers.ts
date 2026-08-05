import { createFileRoute } from '@tanstack/react-router'

type AuthProvider = { name: string; href: string }

// Static Cloudflare Access configuration for this application.
const TEAM_DOMAIN = 'lingering-morning-658a.cloudflareaccess.com'
const APP_AUDIENCE = 'ca0e50f2e3868fb061ee50e86db5a908e7fc22197b29fd836c4b6ef49c3e40d9'

const ENTITIES: Record<string, string> = {
  '&#x2F;': '/',
  '&#x3D;': '=',
  '&#x26;': '&',
  '&#x3F;': '?',
  '&#x3A;': ':',
  '&#x25;': '%',
  '&#x2B;': '+',
  '&#x3B;': ';',
  '&#x40;': '@',
  '&#x23;': '#',
  '&#x2C;': ',',
  '&amp;': '&',
  '&quot;': '"',
  '&#039;': "'",
}

function decodeEntities(s: string): string {
  return s.replace(/&#x2F;|&#x3D;|&#x26;|&#x3F;|&#x3A;|&#x25;|&#x2B;|&#x3B;|&#x40;|&#x23;|&#x2C;|&amp;|&quot;|&#039;/g, (m) => ENTITIES[m])
}

// The Access login page renders one <a class="js-idp" data-idp="Name"> per
// enabled identity provider. Each href is a signed OAuth URL (with a state
// param signed by Access) that starts that provider's login directly. We
// fetch the login page and surface those signed URLs on our own branded page,
// so clicking "Continue with GitHub" deep-links straight into GitHub OAuth.
function parseProviders(html: string): AuthProvider[] {
  const providers: AuthProvider[] = []
  // Attributes may appear in any order, with entities encoded.
  const re = /<a\b[^>]*\bdata-idp="([^"]+)"[^>]*\bhref="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    providers.push({ name: decodeEntities(m[1]), href: decodeEntities(m[2]) })
  }
  return providers
}

export const Route = createFileRoute('/api/auth/providers')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const host = new URL(request.url).host

        // Fetch the Access login page for this application directly (not via
        // our own origin, which a Worker cannot self-fetch). Following
        // redirects lets Access issue the session metadata on the fly.
        const loginUrl = `https://${TEAM_DOMAIN}/cdn-cgi/access/login/${host}?kid=${APP_AUDIENCE}&redirect_url=%2Fdashboard`

        try {
          const resp = await fetch(loginUrl, {
            redirect: 'follow',
            headers: { 'User-Agent': 'Mozilla/5.0' },
          })
          const html = await resp.text()
          const providers = parseProviders(html).filter(
            (p) => p.name === 'Google' || p.name === 'GitHub',
          )
          return Response.json({
            providers,
            debug: {
              status: resp.status,
              len: html.length,
              hasIdpButtons: html.includes('js-idp'),
              first100: html.slice(0, 120),
            },
          })
        } catch (e) {
          return Response.json({ providers: [], error: (e as Error).message })
        }
      },
    },
  },
})
