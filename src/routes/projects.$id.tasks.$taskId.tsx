import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from '@tanstack/react-router'
import { TaskWorkspace } from '#/components/workflow/TaskWorkspace'
import { getTaskWorkflow } from '#/server/workflow'

export const Route = createFileRoute('/projects/$id/tasks/$taskId')({
  loader: async ({ params }) => {
    const task = await getTaskWorkflow({ data: { taskId: params.taskId } })
    if (task.projectId !== params.id) throw notFound()
    return task
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData ? `${loaderData.title} · Planner` : 'Task · Planner',
      },
    ],
  }),
  pendingComponent: () => (
    <div className="tw-route-state" role="status">
      Opening task…
    </div>
  ),
  errorComponent: TaskError,
  notFoundComponent: () => (
    <div className="tw-route-state">
      <h1>Task not found</h1>
      <p>This task does not belong to this project, or it was removed.</p>
      <Link to="/dashboard">Back to Needs you</Link>
    </div>
  ),
  component: TaskPage,
})

function TaskError({ error }: { error: Error }) {
  const router = useRouter()
  return (
    <div className="tw-route-state" role="alert">
      <h1>Could not open this task</h1>
      <p>{error.message}</p>
      <button type="button" onClick={() => void router.invalidate()}>
        Try again
      </button>
      <Link to="/dashboard">Back to Needs you</Link>
    </div>
  )
}

function TaskPage() {
  const task = Route.useLoaderData()
  return <TaskWorkspace key={task.id} initialTask={task} />
}
