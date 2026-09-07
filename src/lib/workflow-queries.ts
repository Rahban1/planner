import { queryOptions, useQuery } from '@tanstack/react-query'
import { getCurrentUser } from '#/server/projects'
import { listWorkflowTasks } from '#/server/workflow'

export const workflowQueryOptions = queryOptions({
  queryKey: ['workflow-tasks'],
  queryFn: () => listWorkflowTasks(),
  refetchInterval: 5000,
  staleTime: 3000,
})
export const currentUserQueryOptions = queryOptions({
  queryKey: ['current-user'],
  queryFn: () => getCurrentUser(),
  staleTime: 60000,
})
export function useWorkflowTasks() {
  return useQuery(workflowQueryOptions)
}
