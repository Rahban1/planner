import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { extname, isAbsolute, join, posix, relative, sep } from 'node:path'

export const PROOF_START = '<!-- planner-proof:start -->'
export const PROOF_END = '<!-- planner-proof:end -->'
export const MAX_PROOF_FILE_BYTES = 10 * 1024 * 1024
export const MAX_PROOF_BUNDLE_BYTES = 20 * 1024 * 1024

export type ProofStatus = 'pass' | 'fail' | 'blocked' | 'not_run'
export type ProofState = 'pass' | 'fail' | 'partial' | 'incomplete'
export type ChangeType = 'ui' | 'api' | 'cli' | 'library' | 'data' | 'docs' | 'mixed'
export type ArtifactType = 'report' | 'log' | 'screenshot' | 'video'

export interface ProofEnvironment {
  os: string
  runtime: string
  browser?: string
}

export interface ProofCheck {
  id: string
  title: string
  layer: string
  status: ProofStatus
  command?: string
  exitCode?: number
  durationMs?: number
  outputPath?: string
  evidencePaths: string[]
}

export interface ProofArtifact {
  path: string
  type: ArtifactType
  bytes: number
  sha256: string
}

export interface ProofManifestV1 {
  version: 1
  runId: string
  testedCommitSha: string
  generatedAt: string
  environment: ProofEnvironment
  changeType: ChangeType
  overall: 'pass' | 'fail' | 'partial'
  checks: ProofCheck[]
  artifacts: ProofArtifact[]
  limitations: string[]
  reproduce: string[]
}

export interface ProofPack {
  state: ProofState
  manifest: ProofManifestV1 | null
  proofDir: string | null
  artifactCommitSha?: string
  errors: string[]
}

interface LoadProofPackOptions {
  repoDir: string
  runId: string
  allowedCommitShas?: string[]
  committedPaths?: string[]
  artifactCommitSha?: string
}

const PROOF_STATUSES = new Set<ProofStatus>(['pass', 'fail', 'blocked', 'not_run'])
const CHANGE_TYPES = new Set<ChangeType>([
  'ui',
  'api',
  'cli',
  'library',
  'data',
  'docs',
  'mixed',
])
const ARTIFACT_TYPES = new Set<ArtifactType>(['report', 'log', 'screenshot', 'video'])
const ALLOWED_EXTENSIONS: Record<ArtifactType, Set<string>> = {
  report: new Set(['.md']),
  log: new Set(['.txt', '.log', '.exit']),
  screenshot: new Set(['.png', '.jpg', '.jpeg']),
  video: new Set(['.webm', '.mp4', '.mov']),
}

export async function loadProofPack({
  repoDir,
  runId,
  allowedCommitShas,
  committedPaths,
  artifactCommitSha,
}: LoadProofPackOptions): Promise<ProofPack> {
  const proofDir = join(repoDir, '.planner', 'proof', runId)
  const manifestPath = join(proofDir, 'manifest.json')
  let raw: unknown

  try {
    raw = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    const reason = error instanceof SyntaxError ? 'manifest.json is not valid JSON' : 'manifest.json was not found'
    return { state: 'incomplete', manifest: null, proofDir: null, artifactCommitSha, errors: [reason] }
  }

  const errors: string[] = []
  const manifest = parseManifest(raw, errors)
  if (!manifest) {
    return { state: 'incomplete', manifest: null, proofDir, artifactCommitSha, errors }
  }

  if (manifest.runId !== runId) {
    errors.push(`Manifest runId must be ${runId}.`)
  }
  if (
    allowedCommitShas &&
    allowedCommitShas.length > 0 &&
    !allowedCommitShas.includes(manifest.testedCommitSha)
  ) {
    errors.push('The tested commit is not in the pull request.')
  }

  const proofRoot = await realpath(proofDir).catch(() => null)
  if (!proofRoot) {
    errors.push('The proof directory does not exist.')
  } else {
    await validateArtifacts(proofRoot, manifest, errors)
  }

  validateReferences(manifest, errors)
  validateRequiredArtifacts(manifest, errors)
  validateCommittedPaths(manifest, runId, committedPaths, errors)

  const expectedOverall = overallFromChecks(manifest.checks)
  if (manifest.overall !== expectedOverall) {
    errors.push(`Manifest overall must be ${expectedOverall} for the recorded check results.`)
  }

  return {
    state: errors.length > 0 ? 'incomplete' : manifest.overall,
    manifest,
    proofDir,
    artifactCommitSha,
    errors,
  }
}

function parseManifest(raw: unknown, errors: string[]): ProofManifestV1 | null {
  if (!isRecord(raw)) {
    errors.push('Manifest must be a JSON object.')
    return null
  }

  if (raw.version !== 1) errors.push('Manifest version must be 1.')
  if (!isNonEmptyString(raw.runId)) errors.push('Manifest runId is required.')
  if (!isSha(raw.testedCommitSha)) errors.push('Manifest testedCommitSha must be a 40-character Git SHA.')
  if (!isDateString(raw.generatedAt)) errors.push('Manifest generatedAt must be an ISO date.')
  if (!CHANGE_TYPES.has(raw.changeType as ChangeType)) errors.push('Manifest changeType is invalid.')
  if (!['pass', 'fail', 'partial'].includes(String(raw.overall))) errors.push('Manifest overall is invalid.')

  if (!isRecord(raw.environment)) {
    errors.push('Manifest environment is required.')
  } else {
    if (!isNonEmptyString(raw.environment.os)) errors.push('Environment os is required.')
    if (!isNonEmptyString(raw.environment.runtime)) errors.push('Environment runtime is required.')
    if (raw.environment.browser !== undefined && !isNonEmptyString(raw.environment.browser)) {
      errors.push('Environment browser must be a non-empty string when present.')
    }
  }

  const checks = Array.isArray(raw.checks) ? raw.checks : []
  if (checks.length === 0) errors.push('Manifest must contain at least one check.')
  checks.forEach((check, index) => validateCheck(check, index, errors))

  const artifacts = Array.isArray(raw.artifacts) ? raw.artifacts : []
  if (artifacts.length === 0) errors.push('Manifest must contain at least one artifact.')
  artifacts.forEach((artifact, index) => validateArtifactShape(artifact, index, errors))

  if (!isStringArray(raw.limitations)) errors.push('Manifest limitations must be a string array.')
  if (!isStringArray(raw.reproduce)) errors.push('Manifest reproduce must be a string array.')

  if (errors.length > 0) return null
  return raw as unknown as ProofManifestV1
}

function validateCheck(raw: unknown, index: number, errors: string[]) {
  if (!isRecord(raw)) {
    errors.push(`Check ${index + 1} must be an object.`)
    return
  }
  if (!isNonEmptyString(raw.id)) errors.push(`Check ${index + 1} id is required.`)
  if (!isNonEmptyString(raw.title)) errors.push(`Check ${index + 1} title is required.`)
  if (!isNonEmptyString(raw.layer)) errors.push(`Check ${index + 1} layer is required.`)
  if (!PROOF_STATUSES.has(raw.status as ProofStatus)) errors.push(`Check ${index + 1} status is invalid.`)
  if (raw.durationMs === undefined) {
    if (raw.status === 'pass' || raw.status === 'fail') {
      errors.push(`Check ${index + 1} durationMs is required for a completed check.`)
    }
  } else if (!Number.isFinite(raw.durationMs) || Number(raw.durationMs) < 0) {
    errors.push(`Check ${index + 1} durationMs must be zero or greater when present.`)
  }
  if (raw.command !== undefined && !isNonEmptyString(raw.command)) {
    errors.push(`Check ${index + 1} command must be a non-empty string.`)
  }
  if (raw.exitCode !== undefined && !Number.isInteger(raw.exitCode)) {
    errors.push(`Check ${index + 1} exitCode must be an integer.`)
  }
  if (raw.outputPath !== undefined && !isNonEmptyString(raw.outputPath)) {
    errors.push(`Check ${index + 1} outputPath must be a non-empty string.`)
  }
  if (!isStringArray(raw.evidencePaths)) {
    errors.push(`Check ${index + 1} evidencePaths must be a string array.`)
  }
}

function validateArtifactShape(raw: unknown, index: number, errors: string[]) {
  if (!isRecord(raw)) {
    errors.push(`Artifact ${index + 1} must be an object.`)
    return
  }
  if (!isNonEmptyString(raw.path)) errors.push(`Artifact ${index + 1} path is required.`)
  if (!ARTIFACT_TYPES.has(raw.type as ArtifactType)) errors.push(`Artifact ${index + 1} type is invalid.`)
  if (!Number.isInteger(raw.bytes) || Number(raw.bytes) < 0) {
    errors.push(`Artifact ${index + 1} bytes must be a non-negative integer.`)
  }
  if (!isSha256(raw.sha256)) errors.push(`Artifact ${index + 1} sha256 is invalid.`)
}

async function validateArtifacts(
  proofRoot: string,
  manifest: ProofManifestV1,
  errors: string[],
) {
  let bundleBytes = 0
  const seen = new Set<string>()

  for (const artifact of manifest.artifacts) {
    if (!isSafeRelativePath(artifact.path)) {
      errors.push(`Artifact path must be a safe relative path: ${artifact.path}`)
      continue
    }
    if (seen.has(artifact.path)) {
      errors.push(`Artifact path is duplicated: ${artifact.path}`)
      continue
    }
    seen.add(artifact.path)

    if (artifact.bytes > MAX_PROOF_FILE_BYTES) {
      errors.push(`Artifact exceeds the 10 MB limit: ${artifact.path}`)
      continue
    }
    bundleBytes += artifact.bytes

    const extension = extname(artifact.path).toLowerCase()
    if (!ALLOWED_EXTENSIONS[artifact.type].has(extension)) {
      errors.push(`Artifact extension does not match type ${artifact.type}: ${artifact.path}`)
    }

    const absolutePath = join(proofRoot, ...artifact.path.split('/'))
    try {
      const stat = await lstat(absolutePath)
      if (stat.isSymbolicLink()) {
        errors.push(`Artifact must not be a symbolic link: ${artifact.path}`)
        continue
      }
      if (!stat.isFile()) {
        errors.push(`Artifact must be a regular file: ${artifact.path}`)
        continue
      }
      const resolved = await realpath(absolutePath)
      const pathFromRoot = relative(proofRoot, resolved)
      if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..' || isAbsolute(pathFromRoot)) {
        errors.push(`Artifact resolves outside the proof directory: ${artifact.path}`)
        continue
      }
      if (stat.size !== artifact.bytes) {
        errors.push(`Artifact byte count does not match the file: ${artifact.path}`)
      }
      if (stat.size > MAX_PROOF_FILE_BYTES) {
        errors.push(`Artifact exceeds the 10 MB limit: ${artifact.path}`)
        continue
      }
      const digest = createHash('sha256').update(await readFile(absolutePath)).digest('hex')
      if (digest !== artifact.sha256) {
        errors.push(`Artifact sha256 does not match the file: ${artifact.path}`)
      }
    } catch {
      errors.push(`Artifact file was not found: ${artifact.path}`)
    }
  }

  if (bundleBytes > MAX_PROOF_BUNDLE_BYTES) {
    errors.push('Proof bundle exceeds the 20 MB limit.')
  }
}

function validateReferences(manifest: ProofManifestV1, errors: string[]) {
  const paths = new Set(manifest.artifacts.map((artifact) => artifact.path))
  for (const check of manifest.checks) {
    if (check.outputPath && !paths.has(check.outputPath)) {
      errors.push(`Check ${check.id} refers to an undeclared output artifact: ${check.outputPath}`)
    }
    for (const evidencePath of check.evidencePaths) {
      if (!paths.has(evidencePath)) {
        errors.push(`Check ${check.id} refers to an undeclared evidence artifact: ${evidencePath}`)
      }
    }
  }
}

function validateRequiredArtifacts(manifest: ProofManifestV1, errors: string[]) {
  const paths = new Set(manifest.artifacts.map((artifact) => artifact.path))
  if (!paths.has('report.md')) errors.push('Proof pack must include report.md.')
  const browserCaptureUnavailable = manifest.checks.some(
    (check) =>
      check.layer === 'browser' &&
      (check.status === 'blocked' || check.status === 'not_run'),
  )
  if (
    (manifest.changeType === 'ui' || manifest.changeType === 'mixed') &&
    !browserCaptureUnavailable
  ) {
    for (const required of [
      'screenshots/desktop.png',
      'screenshots/mobile.png',
      'video/ui-flow.webm',
    ]) {
      if (!paths.has(required)) errors.push(`UI proof pack must include ${required}.`)
    }
  }
}

function validateCommittedPaths(
  manifest: ProofManifestV1,
  runId: string,
  committedPaths: string[] | undefined,
  errors: string[],
) {
  if (!committedPaths) return
  const committed = new Set(committedPaths)
  const root = `.planner/proof/${runId}`
  for (const path of ['manifest.json', ...manifest.artifacts.map((artifact) => artifact.path)]) {
    const repositoryPath = `${root}/${path}`
    if (!committed.has(repositoryPath)) {
      errors.push(`Proof file is not committed in the pull request: ${repositoryPath}`)
    }
  }
}

function overallFromChecks(checks: ProofCheck[]): 'pass' | 'fail' | 'partial' {
  if (checks.some((check) => check.status === 'fail')) return 'fail'
  if (checks.some((check) => check.status === 'blocked' || check.status === 'not_run')) {
    return 'partial'
  }
  return 'pass'
}

export function renderProofSection(proof: ProofPack): string {
  const lines = [PROOF_START, '## Verification proof', '']
  lines.push(`**Verification result: ${proof.state.toUpperCase()}**`)
  lines.push('')
  lines.push('This report proves only the checks shown below. It does not prove that the change has no defects.')

  if (!proof.manifest) {
    lines.push('', '### Proof problems', '')
    lines.push(...proof.errors.map((error) => `- ${escapeMarkdown(error)}`))
    lines.push('', PROOF_END)
    return lines.join('\n')
  }

  const manifest = proof.manifest
  const artifactCommitSha = proof.artifactCommitSha ?? manifest.testedCommitSha
  const root = `.planner/proof/${manifest.runId}`
  lines.push('')
  lines.push(`- Tested commit: \`${manifest.testedCommitSha}\``)
  lines.push(`- Change type: ${escapeMarkdown(manifest.changeType)}`)
  lines.push(`- Environment: ${escapeMarkdown(environmentLabel(manifest.environment))}`)
  lines.push(`- Generated: ${escapeMarkdown(manifest.generatedAt)}`)

  lines.push('', '### Test matrix', '')
  lines.push('| Check | Layer | Result | Duration |')
  lines.push('|---|---|---:|---:|')
  for (const check of manifest.checks) {
    lines.push(
      `| ${escapeTable(check.title)} | ${escapeTable(check.layer)} | **${statusLabel(check.status)}** | ${formatDuration(check.durationMs)} |`,
    )
  }

  const commandChecks = manifest.checks.filter((check) => check.command)
  if (commandChecks.length > 0) {
    lines.push('', '### Commands', '')
    lines.push('| Command | Exit | Output |')
    lines.push('|---|---:|---|')
    for (const check of commandChecks) {
      const output = check.outputPath
        ? `[log](${proofLink(artifactCommitSha, `${root}/${check.outputPath}`)})`
        : 'Not recorded'
      lines.push(
        `| \`${escapeCode(check.command ?? '')}\` | ${check.exitCode ?? 'N/A'} | ${output} |`,
      )
    }
  }

  const screenshots = manifest.artifacts.filter((artifact) => artifact.type === 'screenshot')
  const videos = manifest.artifacts.filter((artifact) => artifact.type === 'video')
  if (screenshots.length > 0 || videos.length > 0) {
    lines.push('', '### Visual evidence', '')
    for (const screenshot of screenshots) {
      const label = screenshot.path.includes('mobile') ? 'Mobile result' : 'Desktop result'
      lines.push(`**${label}**`, '')
      lines.push(`![${label}](${proofLink(artifactCommitSha, `${root}/${screenshot.path}`, true)})`, '')
    }
    for (const video of videos) {
      lines.push(`- [Watch the recorded user flow](${proofLink(artifactCommitSha, `${root}/${video.path}`)})`)
    }
  }

  lines.push('', '### Reproduce', '')
  if (manifest.reproduce.length === 0) {
    lines.push('- No reproduction command was recorded.')
  } else {
    lines.push(...manifest.reproduce.map((command) => `- \`${escapeCode(command)}\``))
  }

  lines.push('', '### Limitations', '')
  if (manifest.limitations.length === 0) {
    lines.push('- None recorded.')
  } else {
    lines.push(...manifest.limitations.map((limitation) => `- ${escapeMarkdown(limitation)}`))
  }

  if (proof.errors.length > 0) {
    lines.push('', '### Proof problems', '')
    lines.push(...proof.errors.map((error) => `- ${escapeMarkdown(error)}`))
  }

  lines.push('', `[Open the full proof report](${proofLink(artifactCommitSha, `${root}/report.md`)})`)
  lines.push('', PROOF_END)
  return lines.join('\n')
}

export function upsertProofSection(body: string | null | undefined, section: string): string {
  const current = body?.trim() ?? ''
  const managed = new RegExp(`${escapeRegExp(PROOF_START)}[\\s\\S]*?${escapeRegExp(PROOF_END)}`)
  if (managed.test(current)) return current.replace(managed, section).trim()
  return current ? `${current}\n\n${section}` : section
}

function proofLink(commitSha: string, path: string, raw = false): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `../blob/${commitSha}/${encodedPath}${raw ? '?raw=true' : ''}`
}

function environmentLabel(environment: ProofEnvironment) {
  return [environment.os, environment.runtime, environment.browser].filter(Boolean).join(', ')
}

function statusLabel(status: ProofStatus) {
  if (status === 'not_run') return 'NOT RUN'
  return status.toUpperCase()
}

function formatDuration(durationMs?: number) {
  if (durationMs === undefined) return 'N/A'
  if (durationMs < 1000) return `${durationMs} ms`
  return `${(durationMs / 1000).toFixed(1)} s`
}

function isSafeRelativePath(path: string) {
  if (!path || isAbsolute(path) || path.includes('\\')) return false
  const normalized = posix.normalize(path)
  return normalized === path && !normalized.startsWith('../') && normalized !== '..'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isSha(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value)
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function escapeMarkdown(value: string) {
  return value.replace(/[<>&]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[character] ?? character)
}

function escapeTable(value: string) {
  return escapeMarkdown(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function escapeCode(value: string) {
  return value.replace(/`/g, '\\`').replace(/\r?\n/g, ' ')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
