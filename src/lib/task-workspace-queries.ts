import { queryOptions } from '@tanstack/react-query'
import { getTaskReview, getTaskWorkflow } from '#/server/workflow'

export const taskWorkflowQueryOptions = (taskId: string) =>
  queryOptions({
    queryKey: ['tasks', taskId, 'workflow'] as const,
    queryFn: () => getTaskWorkflow({ data: { taskId } }),
    refetchInterval: 5_000,
    staleTime: 2_000,
  })

export const taskReviewQueryOptions = (taskId: string, enabled: boolean) =>
  queryOptions({
    queryKey: ['tasks', taskId, 'review'] as const,
    queryFn: () => getTaskReview({ data: { taskId } }),
    enabled,
    refetchInterval: enabled ? 30_000 : false,
    staleTime: 15_000,
  })

export type TaskWorkflow = Awaited<ReturnType<typeof getTaskWorkflow>>
export type TaskReview = Awaited<ReturnType<typeof getTaskReview>>
