import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Paperclip, Send, Check, Bot, Users } from 'lucide-react'
import { MessageScroller, Message, Bubble, Marker } from '#/components/chat/MessageScroller'
import { getCurrentUser } from '#/server/projects'
import { getTaskChat, markTaskChatRead, sendTaskMessage, confirmAgentAction } from '#/server/chat'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '#/lib/queries'

export const Route = createFileRoute('/projects/$id/tasks/$taskId')({
  loader: async ({ params, location }) => {
    if (!(await getCurrentUser())) {
      throw redirect({ to: '/login', search: { redirect: location.href, error: undefined, detail: undefined } })
    }
    return getTaskChat({ data: { taskId: params.taskId } })
  },
  component: TaskChatPage,
})

function TaskChatPage() {
  const { id: projectId, taskId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const loader = Route.useLoaderData()
  const [body, setBody] = useState('')
  const [typing, setTyping] = useState(false)
  const chat = useQuery({
    queryKey: qk.taskChat(taskId),
    queryFn: () => getTaskChat({ data: { taskId } }),
    initialData: loader,
    refetchInterval: 5000,
  })
  const send = useMutation({
    mutationFn: (value: string) => sendTaskMessage({ data: { taskId, body: value, clientMessageId: crypto.randomUUID() } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.taskChat(taskId) }),
  })
  const confirm = useMutation({
    mutationFn: (messageId: string) => confirmAgentAction({ data: { messageId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.taskChat(taskId) }),
  })

  useEffect(() => {
    const messages = chat.data?.messages ?? []
    const last = messages.at(-1)
    if (last) void markTaskChatRead({ data: { taskId, messageId: last.id } })
  }, [chat.data?.messages, taskId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/chat/${taskId}`)
    socket.onmessage = () => {
      void queryClient.invalidateQueries({ queryKey: qk.taskChat(taskId) })
    }
    return () => socket.close()
  }, [taskId, queryClient])

  const title = useMemo(() => {
    const first = (chat.data?.messages ?? []).find((message) => message.authorType === 'user')
    return first?.body.split(/\r?\n/)[0]?.slice(0, 96) || 'Task conversation'
  }, [chat.data?.messages])

  const submit = () => {
    const value = body.trim()
    if (!value || send.isPending) return
    setBody('')
    send.mutate(value)
  }

  return (
    <main className="task-chat-page">
      <header className="task-chat-header">
        <button className="btn btn-ghost" onClick={() => navigate({ to: '/projects/$id', params: { id: projectId } })}>
          <ArrowLeft size={15} /> Back to project
        </button>
        <div className="task-chat-heading">
          <span className="task-chat-eyebrow">Shared task chat</span>
          <h1>{title}</h1>
          <div className="task-chat-meta"><span>discussion</span><span><Users size={13} /> project members</span><span><Bot size={13} /> @agent available</span></div>
        </div>
      </header>

      <section className="task-chat-shell">
        <MessageScroller>
          {(chat.data?.messages ?? []).map((message) => {
            const metadata = message.metadata ? safeJson(message.metadata) : {}
            const isMine = message.authorType === 'user'
            const tone = message.authorType === 'agent' ? 'agent' : message.authorType === 'system' ? 'system' : 'default'
            return (
              <Message key={message.id} mine={isMine}>
                {message.kind === 'action_request' && metadata.intent === 'implement' ? (
                  <div className="task-chat-action-card">
                    <div className="task-chat-card-title"><Bot size={16} /> Implementation request detected</div>
                    <p>{message.body}</p>
                    <button className="btn btn-primary" onClick={() => confirm.mutate(message.id)} disabled={confirm.isPending}>
                      <Check size={14} /> Confirm and start agent
                    </button>
                  </div>
                ) : message.kind === 'action_request' ? (
                  <div className="task-chat-action-card"><div className="task-chat-card-title"><Bot size={16} /> Agent request</div><p>{message.body}</p></div>
                ) : (
                  <Bubble tone={tone}>{message.body}</Bubble>
                )}
                <span className="task-chat-author">{message.authorType === 'agent' ? 'Agent' : message.authorType === 'system' ? 'Planner' : 'You'}</span>
              </Message>
            )
          })}
          {typing && <Marker>Someone is typing…</Marker>}
        </MessageScroller>
        <form className="task-chat-composer" onSubmit={(event) => { event.preventDefault(); submit() }}>
          <textarea
            value={body}
            onChange={(event) => { setBody(event.target.value); setTyping(event.target.value.length > 0) }}
            onBlur={() => setTyping(false)}
            placeholder="Write to the team. Mention @agent to ask a question, request a plan, or request an implementation."
            rows={3}
          />
          <div className="task-chat-composer-actions">
            <button type="button" className="btn btn-ghost" title="Attachments are available from the task drawer"><Paperclip size={15} /> Attach</button>
            <button type="submit" className="btn btn-primary" disabled={!body.trim() || send.isPending}><Send size={14} /> Send</button>
          </div>
        </form>
      </section>
    </main>
  )
}

function safeJson(value: string): Record<string, string> {
  try { return JSON.parse(value) as Record<string, string> } catch { return {} }
}
