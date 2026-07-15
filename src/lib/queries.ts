import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  listPriority
  
} from '#/server/priority'
import type {PriorityCard} from '#/server/priority';
import {
  createProject,
  archiveProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from '#/server/projects'
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  listProjectSummary,

  uncompleteTask,
  updateTask
} from '#/server/tasks'
import {
  listAttachmentsForTask,
  uploadAttachment,
  deleteAttachment,
} from '#/server/attachments'
import {
  getAgentRun,
  getAgentRunForTask,
  giveTaskToAgent,
  listAgentRuns,
} from '#/server/agent'
import type {TaskWithSubtasks} from '#/server/tasks';
import type { Project, Task, Attachment } from '#/db/schema'

export type { Project, Task, Attachment, PriorityCard, TaskWithSubtasks }

// ----- query keys -----
export const qk = {
  projects: ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  projectSummary: (id: string) => ['projects', id, 'summary'] as const,
  priority: ['priority'] as const,
  task: (id: string) => ['tasks', id] as const,
  attachments: (taskId: string) => ['tasks', taskId, 'attachments'] as const,
  agentRun: (id: string) => ['agent-runs', id] as const,
  agentRunForTask: (taskId: string) => ['agent-runs', 'task', taskId] as const,
  agentRuns: ['agent-runs'] as const,
}

// ----- query options -----
export const projectsQueryOptions = queryOptions({
  queryKey: qk.projects,
  queryFn: () => listProjects(),
  staleTime: 60_000,
})

export const projectQueryOptions = (id: string) =>
  queryOptions({
    queryKey: qk.project(id),
    queryFn: () => getProject({ data: { id } }),
    enabled: !!id,
  })

export const projectSummaryQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: qk.projectSummary(projectId),
    queryFn: () => listProjectSummary({ data: { projectId } }),
    enabled: !!projectId,
  })

export const priorityQueryOptions = queryOptions({
  queryKey: qk.priority,
  queryFn: () => listPriority(),
  staleTime: 30_000,
})

export const taskQueryOptions = (id: string) =>
  queryOptions({
    queryKey: qk.task(id),
    queryFn: () => getTask({ data: { id } }),
    enabled: !!id,
  })

export const attachmentsQueryOptions = (taskId: string) =>
  queryOptions({
    queryKey: qk.attachments(taskId),
    queryFn: () => listAttachmentsForTask({ data: { taskId } }),
    enabled: !!taskId,
  })

// ----- convenience hooks -----
export function useProjects() {
  return useQuery(projectsQueryOptions)
}
export function useProject(id?: string) {
  return useQuery(projectQueryOptions(id ?? ''))
}
export function useProjectSummary(projectId?: string) {
  return useQuery(projectSummaryQueryOptions(projectId ?? ''))
}
export function usePriority() {
  return useQuery(priorityQueryOptions)
}
export function useTask(id?: string) {
  return useQuery(taskQueryOptions(id ?? ''))
}
export function useAttachments(taskId?: string) {
  return useQuery(attachmentsQueryOptions(taskId ?? ''))
}

export const agentRunQueryOptions = (id: string) =>
  queryOptions({
    queryKey: qk.agentRun(id),
    queryFn: () => getAgentRun({ data: { id } }),
    enabled: !!id,
  })

export const agentRunForTaskQueryOptions = (taskId: string) =>
  queryOptions({
    queryKey: qk.agentRunForTask(taskId),
    queryFn: () => getAgentRunForTask({ data: { taskId } }),
    enabled: !!taskId,
  })

export function useAgentRun(id?: string) {
  return useQuery(agentRunQueryOptions(id ?? ''))
}

export function useAgentRunForTask(taskId?: string) {
  return useQuery(agentRunForTaskQueryOptions(taskId ?? ''))
}

export const agentRunsQueryOptions = queryOptions({
  queryKey: qk.agentRuns,
  queryFn: () => listAgentRuns(),
  staleTime: 5_000,
  refetchInterval: 5_000,
})

export function useAgentRuns() {
  return useQuery(agentRunsQueryOptions)
}

// ----- mutations -----

interface ProjectSummary {
  active: TaskWithSubtasks[]
  completed: Task[]
}

export function useCreateProjectMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      if (!project) return
      qc.setQueryData<Project[]>(qk.projects, (prev) => [...(prev ?? []), project])
    },
  })
}

export function useUpdateProjectMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateProject,
    onSuccess: (project) => {
      if (!project) return
      qc.setQueryData<Project>(qk.project(project.id), project)
      qc.setQueryData<Project[]>(qk.projects, (prev) =>
        prev?.map((p) => (p.id === project.id ? project : p)),
      )
      qc.invalidateQueries({ queryKey: qk.priority })
    },
  })
}

export function useArchiveProjectMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: archiveProject,
    onSuccess: (_res, vars) => {
      qc.setQueryData<Project[]>(qk.projects, (prev) =>
        prev?.filter((p) => p.id !== vars.data.id),
      )
      qc.removeQueries({ queryKey: qk.projectSummary(vars.data.id) })
      qc.invalidateQueries({ queryKey: qk.priority })
    },
  })
}

export function useDeleteProjectMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: (_res, vars) => {
      qc.setQueryData<Project[]>(qk.projects, (prev) =>
        prev?.filter((p) => p.id !== vars.data.id),
      )
      qc.removeQueries({ queryKey: qk.project(vars.data.id) })
      qc.removeQueries({ queryKey: qk.projectSummary(vars.data.id) })
      qc.invalidateQueries({ queryKey: qk.priority })
    },
  })
}

export function useCreateTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createTask,
    onSuccess: (task) => {
      if (!task) return
      qc.setQueryData<TaskWithSubtasks>(qk.task(task.id), task)
      if (!task.parentId) {
        qc.setQueryData<ProjectSummary>(qk.projectSummary(task.projectId), (prev) =>
          prev ? { ...prev, active: [...prev.active, task] } : prev,
        )
      } else {
        // Subtask: refresh the parent summary to pick up the new child
        qc.invalidateQueries({ queryKey: qk.projectSummary(task.projectId) })
        qc.invalidateQueries({ queryKey: qk.task(task.parentId) })
      }
      qc.invalidateQueries({ queryKey: qk.priority })
    },
  })
}

export function useUpdateTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateTask,
    onSuccess: (task) => {
      if (!task) return
      qc.setQueryData<TaskWithSubtasks>(qk.task(task.id), task)
      // Refresh summary so priority, due, title all reflect
      qc.invalidateQueries({ queryKey: qk.projectSummary(task.projectId) })
      qc.invalidateQueries({ queryKey: qk.priority })
    },
  })
}

export function useCompleteTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: completeTask,
    onSuccess: (task) => {
      if (task) qc.invalidateQueries({ queryKey: qk.projectSummary(task.projectId) })
      qc.invalidateQueries({ queryKey: qk.priority })
    },
  })
}

export function useUncompleteTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: uncompleteTask,
    onSuccess: (task) => {
      if (task) qc.invalidateQueries({ queryKey: qk.projectSummary(task.projectId) })
      qc.invalidateQueries({ queryKey: qk.priority })
    },
  })
}

export function useDeleteTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteTask,
    onSuccess: (_res, vars) => {
      qc.removeQueries({ queryKey: qk.task(vars.data.id) })
      qc.invalidateQueries({ queryKey: qk.projects })
      qc.invalidateQueries({ queryKey: qk.priority })
    },
  })
}

export function useGiveTaskToAgentMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: giveTaskToAgent,
    onSuccess: (run) => {
      if (!run) return
      qc.setQueryData(qk.agentRun(run.id), run)
      qc.setQueryData(qk.agentRunForTask(run.taskId), run)
      qc.invalidateQueries({ queryKey: qk.agentRuns })
    },
  })
}

export function useUploadAttachmentMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: uploadAttachment,
    onSuccess: (attachment, vars) => {
      if (!attachment) return
      const taskId = vars.data.get('taskId')
      if (typeof taskId === 'string') {
        qc.invalidateQueries({ queryKey: qk.attachments(taskId) })
        qc.invalidateQueries({ queryKey: qk.task(taskId) })
      }
    },
  })
}

export function useDeleteAttachmentMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteAttachment,
    onSuccess: (attachment) => {
      if (!attachment) return
      qc.invalidateQueries({ queryKey: qk.attachments(attachment.taskId) })
      qc.invalidateQueries({ queryKey: qk.task(attachment.taskId) })
    },
  })
}