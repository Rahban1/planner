export type RepositoryRunStatus =
  'pending' | 'skipped' | 'success' | 'merged' | 'closed' | 'error'

export function aggregateRepositoryStatus(
  statuses: RepositoryRunStatus[],
): 'success' | 'merged' | 'closed' {
  const required = statuses.filter((status) => status !== 'skipped')
  if (required.some((status) => status === 'closed' || status === 'error')) {
    return 'closed'
  }
  if (required.length > 0 && required.every((status) => status === 'merged')) {
    return 'merged'
  }
  return 'success'
}
