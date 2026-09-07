export type ReviewContext = {
  repoUrl?: string
  path?: string
  line?: number
  side?: 'LEFT' | 'RIGHT'
  headSha?: string
}

export type PatchLine = {
  text: string
  kind: 'added' | 'removed' | 'context' | 'header'
  oldLine?: number
  newLine?: number
}

/** GitHub patch hunks use separate line counters for the old and new files. */
export function parsePatch(patch: string): PatchLine[] {
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  return patch.split('\n').map((text): PatchLine => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      inHunk = true
      return { text, kind: 'header' }
    }
    if (!inHunk || text.startsWith('\\') || text === '')
      return { text, kind: 'header' }
    if (text.startsWith('+')) return { text, kind: 'added', newLine: newLine++ }
    if (text.startsWith('-'))
      return { text, kind: 'removed', oldLine: oldLine++ }
    return { text, kind: 'context', oldLine: oldLine++, newLine: newLine++ }
  })
}

export function repositoryName(url: string) {
  return url
    .replace(/^https?:\/\/(?:www\.)?github\.com\//, '')
    .replace(/\.git\/?$/, '')
}

export function readMessageMetadata(value: string | null): {
  mode?: string
  context?: ReviewContext
} {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return {}
    const metadata = parsed as Record<string, unknown>
    const review =
      metadata.review && typeof metadata.review === 'object'
        ? (metadata.review as Record<string, unknown>)
        : undefined
    const context = metadata.context ?? review?.context
    let safeContext: ReviewContext | undefined
    if (context && typeof context === 'object') {
      const fields = context as Record<string, unknown>
      safeContext = {
        repoUrl:
          typeof fields.repoUrl === 'string' ? fields.repoUrl : undefined,
        path: typeof fields.path === 'string' ? fields.path : undefined,
        line: typeof fields.line === 'number' ? fields.line : undefined,
        side:
          fields.side === 'LEFT' || fields.side === 'RIGHT'
            ? fields.side
            : undefined,
        headSha:
          typeof fields.headSha === 'string' ? fields.headSha : undefined,
      }
    }
    return {
      mode: typeof metadata.mode === 'string' ? metadata.mode : undefined,
      context: safeContext,
    }
  } catch {
    return {}
  }
}
