import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { getUserFromCookie } from '#/server/auth'
import { eq } from 'drizzle-orm'
import { db, schema } from '#/db/index'

type ChatEnv = Env & { TASK_CHAT_ROOMS?: DurableObjectNamespace }

export const Route = createFileRoute('/api/chat/$taskId')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const user = await getUserFromCookie(request.headers.get('cookie'))
        if (!user) return new Response('Unauthorized', { status: 401 })
        const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, params.taskId))
        if (!task) return new Response('Task not found', { status: 404 })
        const members = await db.select().from(schema.projectMembers).where(eq(schema.projectMembers.projectId, task.projectId))
        if (members.length > 0 && !members.some((member) => member.email.toLowerCase() === user.email.toLowerCase())) {
          return new Response('Forbidden', { status: 403 })
        }
        const namespace = (env as ChatEnv).TASK_CHAT_ROOMS
        if (!namespace) return new Response('Realtime chat is not configured', { status: 503 })
        const id = namespace.idFromName(params.taskId)
        const stub = namespace.get(id)
        const headers = new Headers(request.headers)
        headers.set('x-planner-user-id', user.id)
        return stub.fetch(new Request(request, { headers }))
      },
    },
  },
})
