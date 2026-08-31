import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface RepositoryWorkspace {
  repoUrl: string
  position: number
  repoDir: string
}

export interface RepositoryHandoff extends RepositoryWorkspace {
  branchName: string | null
  prUrl: string | null
}

export function uniqueRepoUrls(
  primary: string,
  repoUrls: string[] = [],
): string[] {
  return [
    ...new Set([primary, ...repoUrls].map((url) => url.trim()).filter(Boolean)),
  ]
}

export function repositoryWorkspaces(
  workspace: string,
  repoUrls: string[],
): RepositoryWorkspace[] {
  return repoUrls.map((repoUrl, position) => ({
    repoUrl,
    position,
    repoDir:
      position === 0
        ? join(workspace, 'repo')
        : join(workspace, 'context-repos', `repo-${position + 1}`),
  }))
}

export async function readRepositoryHandoffs(
  workspace: string,
  repoUrls: string[],
): Promise<RepositoryHandoff[]> {
  const repositories = repositoryWorkspaces(workspace, repoUrls)
  return Promise.all(
    repositories.map(async (repository) => {
      const branchName = await readMarker(
        repository.repoDir,
        'planner-agent-branch',
      )
      const prUrl = await readMarker(repository.repoDir, 'planner-agent-pr-url')

      if (repository.position !== 0 || branchName || prUrl) {
        return { ...repository, branchName, prUrl }
      }

      // Compatibility with runner prompts that wrote primary-repository markers
      // to the workspace root.
      return {
        ...repository,
        branchName: await readText(join(workspace, '.agent-branch-name')),
        prUrl: await readText(join(workspace, '.agent-pr-url')),
      }
    }),
  )
}

async function readMarker(
  repoDir: string,
  markerName: string,
): Promise<string | null> {
  return readText(join(repoDir, '.git', markerName))
}

async function readText(path: string): Promise<string | null> {
  try {
    if (!existsSync(path)) return null
    return (await readFile(path, 'utf-8')).trim() || null
  } catch {
    return null
  }
}
