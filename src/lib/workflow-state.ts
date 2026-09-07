import type { AgentRun, AgentRunWithRepositories, Task } from '#/db/schema'

export type WorkflowState =
  | 'needs_plan'
  | 'planning'
  | 'plan_ready'
  | 'building'
  | 'review'
  | 'failed'
  | 'done'

export function latestMeaningfulRun<
  T extends Pick<AgentRun, 'kind' | 'createdAt' | 'id'>,
>(runs: T[]) {
  return (
    [...runs]
      .filter((run) => run.kind !== 'answer')
      .sort(
        (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
      )[0] ?? null
  )
}

export function deriveWorkflowState(
  task: Pick<Task, 'status'>,
  runs: AgentRunWithRepositories[],
) {
  const sorted = [...runs].sort(
    (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
  )
  const latestRun = sorted[0] ?? null
  const activeRun =
    sorted.find((run) => run.status === 'queued' || run.status === 'running') ??
    null
  const meaningful = latestMeaningfulRun(sorted)
  const planRun = sorted.find((run) => run.kind === 'plan') ?? null
  const reviewRun =
    sorted.find(
      (run) =>
        (run.kind === 'implement' || run.kind === 'revise') &&
        (run.prUrl || run.repositories.some((repo) => repo.prUrl)),
    ) ?? null
  let state: WorkflowState = 'needs_plan'
  let nextAction = 'Describe the task'
  if (task.status === 'done') {
    state = 'done'
    nextAction = 'Task complete'
  } else if (activeRun && activeRun.kind !== 'answer') {
    state = activeRun.kind === 'plan' ? 'planning' : 'building'
    nextAction =
      activeRun.kind === 'plan'
        ? 'The agent is preparing the plan'
        : 'The agent is working on the code'
  } else if (
    meaningful?.status === 'error' ||
    meaningful?.status === 'stopped' ||
    meaningful?.status === 'closed'
  ) {
    state = 'failed'
    nextAction =
      meaningful.status === 'stopped'
        ? 'Run stopped. Start again when ready'
        : meaningful.status === 'closed'
          ? 'Pull request closed. Check the result'
          : 'Check the failed run'
  } else if (meaningful?.status === 'plan_ready') {
    state = 'plan_ready'
    nextAction = 'Review and approve the plan'
  } else if (reviewRun && reviewRun.status !== 'merged') {
    state = 'review'
    nextAction = 'Review the code changes'
  } else if (meaningful?.status === 'approved') {
    state = 'building'
    nextAction = 'The agent is starting the build'
  } else if (meaningful?.status === 'merged') {
    state = 'done'
    nextAction = 'Task complete'
  }
  return {
    state,
    nextAction,
    needsYou: ['needs_plan', 'plan_ready', 'review', 'failed'].includes(state),
    latestRun,
    activeRun,
    planRun,
    reviewRun,
  }
}

export function parseGitHubPullRequest(
  repoUrl: string,
  prUrl: string,
  expectedNumber?: number | null,
) {
  const repo = new URL(repoUrl)
  const pr = new URL(prUrl)
  const repoMatch = repo.pathname
    .replace(/\.git\/?$/, '')
    .replace(/\/$/, '')
    .match(/^\/([^/]+)\/([^/]+)$/)
  const prMatch = pr.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/)
  if (
    repo.protocol !== 'https:' ||
    pr.protocol !== 'https:' ||
    repo.hostname !== 'github.com' ||
    pr.hostname !== 'github.com' ||
    repo.username ||
    repo.password ||
    pr.username ||
    pr.password ||
    !repoMatch ||
    !prMatch ||
    repoMatch[1].toLowerCase() !== prMatch[1].toLowerCase() ||
    repoMatch[2].toLowerCase() !== prMatch[2].toLowerCase() ||
    (expectedNumber && Number(prMatch[3]) !== expectedNumber)
  )
    throw new Error('Pull request does not match the task repository')
  return {
    owner: repoMatch[1],
    repository: repoMatch[2],
    number: Number(prMatch[3]),
  }
}

export function patchContainsLine(
  patch: string,
  line: number,
  side: 'LEFT' | 'RIGHT',
) {
  let oldLine = 0
  let newLine = 0
  for (const text of patch.split('\n')) {
    const header = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (header) {
      oldLine = Number(header[1])
      newLine = Number(header[2])
      continue
    }
    if (!oldLine && !newLine) continue
    if (text.startsWith('\\')) continue
    if (text.startsWith('+')) {
      if (side === 'RIGHT' && newLine === line) return true
      newLine++
      continue
    }
    if (text.startsWith('-')) {
      if (side === 'LEFT' && oldLine === line) return true
      oldLine++
      continue
    }
    if (text.startsWith(' ')) {
      if ((side === 'LEFT' ? oldLine : newLine) === line) return true
      oldLine++
      newLine++
    }
  }
  return false
}

// A failed revision does not remove the open PR made by its source run.
// An active revision pauses merge completion until its result is saved.
export function mergeTrackedRun<
  T extends Pick<
    AgentRun,
    'id' | 'kind' | 'status' | 'createdAt' | 'sourceRunId'
  >,
>(runs: T[]): T | null {
  let current: T | null = latestMeaningfulRun(runs)
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    if (
      (current.kind === 'implement' || current.kind === 'revise') &&
      current.status === 'success'
    )
      return current
    if (
      current.kind !== 'revise' ||
      !['error', 'stopped'].includes(current.status) ||
      !current.sourceRunId
    )
      return null
    const sourceId: string = current.sourceRunId
    current = runs.find((run) => run.id === sourceId) ?? null
  }
  return null
}
