// Minimal GitHub REST client for checking pull request merge state.

export interface PullRequestState {
  state: string // 'open' | 'closed'
  merged: boolean
  mergedAt: string | null
}

export interface ParsedPrUrl {
  owner: string
  repo: string
  number: number
}

export function parsePrUrl(prUrl: string): ParsedPrUrl | null {
  const match = prUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2], number: Number(match[3]) }
}

export async function getPullRequestState(
  prUrl: string,
  token: string,
): Promise<PullRequestState | null> {
  const parsed = parsePrUrl(prUrl)
  if (!parsed) return null

  const res = await fetch(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'planner-agent-runner',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API ${res.status} for PR ${parsed.owner}/${parsed.repo}#${parsed.number}: ${text.slice(0, 200)}`)
  }

  const body = (await res.json()) as {
    state?: string
    merged?: boolean
    merged_at?: string | null
  }
  return {
    state: body.state ?? 'open',
    merged: body.merged === true,
    mergedAt: body.merged_at ?? null,
  }
}
