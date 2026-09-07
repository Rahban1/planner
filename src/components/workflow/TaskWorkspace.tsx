import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  GitBranch,
  GitPullRequest,
  LoaderCircle,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Settings2,
  Square,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { AgentRun } from '#/db/schema'
import type { TaskReview, TaskWorkflow } from '#/lib/task-workspace-queries'
import type { ReviewContext } from './task-workspace-model'
import {
  taskReviewQueryOptions,
  taskWorkflowQueryOptions,
} from '#/lib/task-workspace-queries'
import {
  attachmentsQueryOptions,
  qk,
  taskChatQueryOptions,
} from '#/lib/queries'
import { useUI } from '#/lib/ui-context'
import {
  approvePlan,
  planTask,
  requestPlanChanges,
  retryAgentRun,
  stopAgentRun,
} from '#/server/agent'
import { markTaskChatRead, sendTaskMessage } from '#/server/chat'
import { uploadAttachment } from '#/server/attachments'
import {
  parsePatch,
  readMessageMetadata,
  repositoryName,
} from './task-workspace-model'
import './task-workspace.css'

type Pane = 'discussion' | 'plan' | 'changes' | 'activity'
type MessageMode = 'discuss' | 'question' | 'change'
type ReviewRepository = TaskReview['repositories'][number]

const labels: Record<string, string> = {
  needs_plan: 'Planning',
  planning: 'Planning',
  plan_ready: 'Plan ready',
  building: 'Building',
  review: 'Ready for review',
  failed: 'Needs attention',
  done: 'Done',
}

function isActive(run: { status: string } | null | undefined) {
  return run?.status === 'queued' || run?.status === 'running'
}

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The request failed. Try again.'
}

function Time({ value }: { value: number }) {
  return (
    <time
      dateTime={new Date(value).toISOString()}
      title={new Date(value).toLocaleString()}
      suppressHydrationWarning
    >
      {new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}
    </time>
  )
}

function Markdown({ children }: { children: string }) {
  return (
    <div className="tw-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children: label, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

function useDraft(key: string) {
  const [value, setValue] = useState('')
  const [storageAvailable, setStorageAvailable] = useState(true)
  useEffect(() => {
    try {
      setValue(localStorage.getItem(key) ?? '')
    } catch {
      setStorageAvailable(false)
    }
  }, [key])
  function update(next: string) {
    setValue(next)
    try {
      if (next) localStorage.setItem(key, next)
      else localStorage.removeItem(key)
    } catch {
      setStorageAvailable(false)
    }
  }
  return { value, update, storageAvailable }
}

function useOnline() {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

function useReviewSelection(key: string) {
  const [selection, setSelection] = useState<{
    mode: MessageMode
    context: ReviewContext
  }>({ mode: 'discuss', context: {} })
  useEffect(() => {
    try {
      const saved = readMessageMetadata(localStorage.getItem(key))
      setSelection({
        mode:
          saved.mode === 'question' || saved.mode === 'change'
            ? saved.mode
            : 'discuss',
        context: saved.context ?? {},
      })
    } catch {
      /* The composer also works when browser storage is disabled. */
    }
  }, [key])
  function update(next: { mode: MessageMode; context: ReviewContext }) {
    setSelection(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      /* Keep the draft in memory. */
    }
  }
  return { selection, update }
}

export function TaskWorkspace({ initialTask }: { initialTask: TaskWorkflow }) {
  const ui = useUI()
  const queryClient = useQueryClient()
  const taskQuery = useQuery({
    ...taskWorkflowQueryOptions(initialTask.id),
    initialData: initialTask,
  })
  const task = taskQuery.data
  const activeRun = task.activeRun
  const active = !!activeRun
  const reviewQuery = useQuery(
    taskReviewQueryOptions(task.id, !!task.reviewRun),
  )
  const chatQuery = useQuery(taskChatQueryOptions(task.id))
  const attachments = useQuery(attachmentsQueryOptions(task.id))
  const online = useOnline()
  const [pane, setPane] = useState<Pane>(() =>
    initialTask.state === 'review'
      ? 'changes'
      : initialTask.state === 'plan_ready'
        ? 'plan'
        : 'discussion',
  )
  const [documentPane, setDocumentPane] = useState<Exclude<Pane, 'discussion'>>(
    () => (initialTask.reviewRun ? 'changes' : 'plan'),
  )
  const reviewSelection = useReviewSelection(
    `planner:review-selection:${task.currentUserId}:${task.id}`,
  )
  const { mode: messageMode, context: reviewContext } =
    reviewSelection.selection
  const setMessageMode = (mode: MessageMode) =>
    reviewSelection.update({ mode, context: reviewContext })
  const setReviewContext = (context: ReviewContext) =>
    reviewSelection.update({ mode: messageMode, context })
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const draft = useDraft(`planner:task-draft:${task.currentUserId}:${task.id}`)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const messageRequest = useRef<{
    body: string
    mode: string
    context: string
    id: string
  } | null>(null)

  function choosePane(next: Pane) {
    setPane(next)
    if (next !== 'discussion') setDocumentPane(next)
  }

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.task(task.id) }),
      queryClient.invalidateQueries({ queryKey: qk.agentRuns }),
      queryClient.invalidateQueries({ queryKey: ['workflow'] }),
      queryClient.invalidateQueries({ queryKey: qk.priority }),
      queryClient.invalidateQueries({ queryKey: qk.project(task.projectId) }),
    ])
  }

  const actionMutation = useMutation({
    mutationFn: async (action: {
      type: 'plan' | 'approve' | 'revise' | 'stop' | 'retry'
      runId?: string
      version?: number
      feedback?: string
    }) => {
      if (action.type === 'plan') return planTask({ data: { taskId: task.id } })
      if (!action.runId)
        throw new Error('The run is missing. Refresh the task and try again.')
      if (action.type === 'approve') {
        if (action.version === undefined)
          throw new Error('Select the current plan version before approval.')
        return approvePlan({
          data: { runId: action.runId, expectedVersion: action.version },
        })
      }
      if (action.type === 'revise') {
        if (action.version === undefined)
          throw new Error(
            'Select the current plan version before sending feedback.',
          )
        return requestPlanChanges({
          data: {
            runId: action.runId,
            expectedVersion: action.version,
            feedback: action.feedback ?? '',
          },
        })
      }
      if (action.type === 'retry')
        return retryAgentRun({ data: { runId: action.runId } })
      return stopAgentRun({ data: { runId: action.runId } })
    },
    onMutate: () => {
      setActionError(null)
      setActionNotice(null)
    },
    onSuccess: async (result, action) => {
      if ('dispatchError' in result && result.dispatchError)
        setActionError(
          `The request is saved, but the agent could not start. ${result.dispatchError}`,
        )
      else
        setActionNotice(
          action.type === 'stop'
            ? 'Stop requested. The runner will stop at its next check.'
            : action.type === 'approve'
              ? `Plan version ${action.version} approved. The build is queued.`
              : action.type === 'revise'
                ? 'Your feedback is saved. The plan revision is queued.'
                : 'The request is queued.',
        )
      await refresh()
    },
    onError: async (error) => {
      setActionError(errorText(error))
      await refresh()
    },
  })

  const sendMutation = useMutation({
    mutationFn: sendTaskMessage,
    onMutate: () => {
      setActionError(null)
      setActionNotice(null)
    },
    onSuccess: async (result, input) => {
      // Do not remove new text that the user entered during the request.
      if (draft.value.trim() === input.data.body) draft.update('')
      messageRequest.current = null
      if (result.dispatchError)
        setActionError(
          `Your message is saved, but the agent could not start. ${result.dispatchError}`,
        )
      else
        setActionNotice(
          input.data.mode === 'change'
            ? 'Your change request is saved. The agent will update the existing pull request.'
            : 'Your message is saved. The agent response is queued.',
        )
      await refresh()
    },
    onError: (error) => setActionError(errorText(error)),
  })

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const data = new FormData()
        data.set('taskId', task.id)
        data.set('file', file)
        await uploadAttachment({ data })
      }
    },
    onSuccess: async () => {
      setActionNotice('Files are attached to this task.')
      await refresh()
    },
    onError: async (error) => {
      setActionError(errorText(error))
      await refresh()
    },
  })

  const hasReview = !!task.reviewRun
  const mode = hasReview
    ? messageMode === 'discuss'
      ? 'question'
      : messageMode
    : 'discuss'
  const pending = actionMutation.isPending || sendMutation.isPending
  const reviewOpen = !!reviewQuery.data?.repositories.some(
    (repo) =>
      !repo.merged &&
      repo.state === 'open' &&
      (!reviewContext.repoUrl || repo.repoUrl === reviewContext.repoUrl),
  )
  const messages = chatQuery.data?.messages ?? []
  const newestMessageId = messages.at(-1)?.id
  useEffect(() => {
    if (newestMessageId)
      void markTaskChatRead({
        data: { taskId: task.id, messageId: newestMessageId },
      }).catch(() => {})
  }, [newestMessageId, task.id])

  function send() {
    const body = draft.value.trim()
    if (!body || pending || active || !online) return
    const context = JSON.stringify(reviewContext)
    if (
      !messageRequest.current ||
      messageRequest.current.body !== body ||
      messageRequest.current.mode !== mode ||
      messageRequest.current.context !== context
    ) {
      messageRequest.current = { body, mode, context, id: crypto.randomUUID() }
    }
    sendMutation.mutate({
      data: {
        taskId: task.id,
        body,
        mode,
        clientMessageId: messageRequest.current.id,
        ...(hasReview
          ? { sourceRunId: task.reviewRun?.id, context: reviewContext }
          : {}),
      },
    })
  }

  function selectContext(context: ReviewContext) {
    reviewSelection.update({ context, mode: 'question' })
    setPane('discussion')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const steps = ['Plan', 'Build', 'Review', 'Done']
  const stage =
    task.state === 'done'
      ? 3
      : task.reviewRun
        ? 2
        : task.state === 'building'
          ? 1
          : 0
  return (
    <main className="tw-page">
      <header className="tw-header">
        <Link to="/dashboard" className="tw-back">
          <ArrowLeft size={14} /> Needs you
        </Link>
        <div className="tw-title-row">
          <div>
            <h1>{task.title}</h1>
            <div className="tw-meta">
              <Link to="/projects/$id" params={{ id: task.projectId }}>
                {task.projectName}
              </Link>
              <span aria-hidden="true">/</span>
              <span className={`tw-status tw-status-${task.state}`}>
                {labels[task.state] ?? task.state}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="tw-button tw-details"
            aria-label="Task details"
            onClick={() =>
              ui.openTask(task.id, task.projectName, task.projectRepoUrls[0])
            }
          >
            <Settings2 size={15} />
            <span>Task details</span>
          </button>
        </div>
        <div className="tw-repositories" aria-label="Project repositories">
          {task.projectRepoUrls.length ? (
            task.projectRepoUrls.map((repo) => (
              <span key={repo}>
                <GitBranch size={12} />
                {repositoryName(repo)}
              </span>
            ))
          ) : (
            <span>
              No repository is linked.{' '}
              <button
                type="button"
                className="tw-text-button"
                onClick={() => ui.openProjectModal(task.projectId)}
              >
                Set up project
              </button>
            </span>
          )}
        </div>
        <div className="tw-stage-row">
          <ol className="tw-stages" aria-label="Task progress">
            {steps.map((step, index) => (
              <li
                key={step}
                aria-current={index === stage ? 'step' : undefined}
                className={index < stage ? 'tw-step-complete' : ''}
              >
                <span className="tw-step-dot">
                  {index < stage ? <Check size={10} /> : index + 1}
                </span>
                {step}
                {index < 3 && <ChevronRight size={12} aria-hidden="true" />}
              </li>
            ))}
          </ol>
          <span className="tw-updated">
            Updated <Time value={task.updatedAt} />
          </span>
        </div>
      </header>

      {!online && (
        <div className="tw-notice" role="status">
          You are offline. Your draft stays on this device. Connect to send it.
        </div>
      )}
      {taskQuery.isError && (
        <ErrorNotice
          error={taskQuery.error}
          onRetry={() => void taskQuery.refetch()}
          label="Task updates could not load"
        />
      )}
      {actionError && (
        <div className="tw-notice tw-notice-error" role="alert">
          {actionError}
          <button
            type="button"
            className="tw-icon-button"
            aria-label="Dismiss error"
            onClick={() => setActionError(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {actionNotice && (
        <div className="tw-notice" role="status">
          {actionNotice}
        </div>
      )}
      {active && (
        <div className="tw-run-banner">
          <div>
            <span className="tw-active-dot" />
            <strong>
              {activeRun.status === 'queued'
                ? 'In the queue'
                : activeRun.kind === 'answer'
                  ? 'Reading and answering'
                  : activeRun.kind === 'plan'
                    ? 'Writing the plan'
                    : 'Implementing the changes'}
            </strong>
            <span>
              {' '}
              {activeRun.status === 'queued'
                ? 'Waiting for the runner to start.'
                : 'You can leave this task and come back.'}
            </span>
          </div>
          <button
            type="button"
            className="tw-button"
            disabled={pending || !online}
            onClick={() =>
              actionMutation.mutate({ type: 'stop', runId: activeRun.id })
            }
          >
            <Square size={12} />
            Stop
          </button>
        </div>
      )}
      {!active &&
        task.latestRun &&
        ['error', 'stopped'].includes(task.latestRun.status) && (
          <div className="tw-notice tw-notice-error">
            <div>
              <strong>
                {task.latestRun.status === 'stopped'
                  ? 'Run stopped.'
                  : 'The run needs attention.'}
              </strong>
              <p>
                {task.latestRun.errorMessage ??
                  'The previous run did not finish.'}
              </p>
            </div>
            <button
              type="button"
              className="tw-button"
              disabled={pending || !online}
              onClick={() =>
                actionMutation.mutate({
                  type: 'retry',
                  runId: task.latestRun?.id,
                })
              }
            >
              <RefreshCw size={14} />
              Retry run
            </button>
          </div>
        )}

      <div className="tw-mobile-tabs" aria-label="Task view">
        {(['discussion', 'plan', 'changes', 'activity'] as const).map(
          (item) => (
            <button
              key={item}
              type="button"
              aria-pressed={pane === item}
              onClick={() => choosePane(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ),
        )}
      </div>

      <div className="tw-workspace">
        <section
          className="tw-discussion"
          data-mobile-hidden={pane !== 'discussion'}
          aria-label="Task discussion"
        >
          <div className="tw-panel-heading">
            <h2>
              <MessageSquare size={16} />
              Discussion
            </h2>
            <span>Plan it together.</span>
          </div>
          <Conversation
            taskId={task.id}
            userId={task.currentUserId}
            messages={messages}
            notes={task.notes}
            loading={chatQuery.isPending}
            error={chatQuery.error}
            onRetry={() => void chatQuery.refetch()}
          />
          <ReviewComposer
            inputRef={inputRef}
            value={draft.value}
            onChange={draft.update}
            mode={mode}
            onModeChange={setMessageMode}
            hasReview={hasReview}
            context={reviewContext}
            onContextChange={setReviewContext}
            repositories={
              reviewQuery.data?.repositories.map((repo) => repo.repoUrl) ?? []
            }
            pending={sendMutation.isPending}
            disabled={!online || active || actionMutation.isPending}
            changeDisabled={!reviewOpen}
            onSend={send}
          />
          <div className="tw-attachment-tools">
            <button
              type="button"
              className="tw-text-button"
              disabled={uploadMutation.isPending || !online || active}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip size={14} />
              {uploadMutation.isPending ? 'Attaching files…' : 'Attach files'}
            </button>
            <span>
              {draft.storageAvailable
                ? 'Draft saved on this device'
                : 'Draft cannot be saved on this device'}
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              if (files.length) uploadMutation.mutate(files)
            }}
          />
          {!!attachments.data?.length && (
            <details className="tw-attachments">
              <summary>
                {attachments.data.length} attached{' '}
                {attachments.data.length === 1 ? 'file' : 'files'}
              </summary>
              <ul>
                {attachments.data.map((file) => (
                  <li key={file.id}>
                    <Paperclip size={12} />
                    <a
                      href={`/api/attachments/${file.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {file.name}
                    </a>
                    <span>{Math.max(1, Math.round(file.size / 1024))} KB</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {attachments.isError && (
            <ErrorNotice
              error={attachments.error}
              onRetry={() => void attachments.refetch()}
              label="Attachments could not load"
            />
          )}
        </section>

        <section
          className="tw-document"
          data-mobile-hidden={pane === 'discussion'}
          aria-label="Task documents"
        >
          <div className="tw-document-tabs" aria-label="Document view">
            {(['plan', 'changes', 'activity'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={documentPane === item}
                onClick={() => choosePane(item)}
              >
                {item === 'plan' ? (
                  <FileText size={15} />
                ) : item === 'changes' ? (
                  <GitPullRequest size={15} />
                ) : (
                  <Clock3 size={15} />
                )}
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <div hidden={documentPane !== 'plan'}>
            <PlanPanel
              key={`${task.planRun?.id}:${task.planRun?.planVersion}`}
              plan={task.planRun}
              draftKey={`planner:plan-feedback:${task.currentUserId}:${task.id}:${task.planRun?.id}:${task.planRun?.planVersion}`}
              pending={actionMutation.isPending}
              disabled={active || !online || sendMutation.isPending}
              canStart={task.projectRepoUrls.length > 0 && !hasReview}
              onStart={() => actionMutation.mutate({ type: 'plan' })}
              onApprove={(runId, version) =>
                actionMutation.mutate({ type: 'approve', runId, version })
              }
              onRequestChanges={(runId, version, feedback) =>
                actionMutation
                  .mutateAsync({ type: 'revise', runId, version, feedback })
                  .then(() => {})
              }
            />
            <PlanHistory
              history={task.planHistory}
              currentMarkdown={task.planRun?.planMd}
            />
          </div>
          <div hidden={documentPane !== 'changes'}>
            <ReviewPanel
              review={reviewQuery.data}
              loading={reviewQuery.isPending && hasReview}
              fetching={reviewQuery.isFetching}
              error={reviewQuery.error}
              hasReview={hasReview}
              onRetry={() => void reviewQuery.refetch()}
              onSelectContext={selectContext}
            />
          </div>
          <div hidden={documentPane !== 'activity'}>
            <ActivityPanel runs={task.runs} />
          </div>
        </section>
      </div>
    </main>
  )
}

function ErrorNotice({
  error,
  onRetry,
  label,
}: {
  error: unknown
  onRetry: () => void
  label: string
}) {
  return (
    <div className="tw-notice tw-notice-error" role="alert">
      <div>
        <strong>{label}.</strong>
        <p>{errorText(error)}</p>
      </div>
      <button type="button" className="tw-button" onClick={onRetry}>
        <RefreshCw size={14} />
        Try again
      </button>
    </div>
  )
}

function Conversation({
  taskId,
  userId,
  messages,
  notes,
  loading,
  error,
  onRetry,
}: {
  taskId: string
  userId: string
  messages: Array<{
    id: string
    authorType: string
    authorUserId: string | null
    body: string
    kind: string
    metadata: string | null
    createdAt: number
  }>
  notes: string | null
  loading: boolean
  error: unknown
  onRetry: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const restored = useRef(false)
  const [newMessages, setNewMessages] = useState(false)
  const scrollKey = `planner:task-scroll:${userId}:${taskId}`
  const latest = messages.at(-1)?.id
  useEffect(() => {
    const node = scrollRef.current
    if (!node || loading) return
    if (!restored.current) {
      let stored: string | null = null
      try {
        stored = sessionStorage.getItem(scrollKey)
      } catch {
        /* Storage can be disabled. */
      }
      node.scrollTop =
        stored !== null && Number.isFinite(Number(stored))
          ? Number(stored)
          : node.scrollHeight
      nearBottom.current =
        node.scrollHeight - node.clientHeight - node.scrollTop < 80
      restored.current = true
    } else if (nearBottom.current) {
      node.scrollTop = node.scrollHeight
    } else {
      setNewMessages(true)
    }
  }, [latest, loading])
  function saveScroll() {
    const node = scrollRef.current
    if (!node) return
    nearBottom.current =
      node.scrollHeight - node.clientHeight - node.scrollTop < 80
    if (nearBottom.current) setNewMessages(false)
    try {
      sessionStorage.setItem(scrollKey, String(node.scrollTop))
    } catch {
      /* Keep scrolling available. */
    }
  }
  return (
    <div className="tw-conversation-wrap">
      <div
        className="tw-conversation"
        ref={scrollRef}
        onScroll={saveScroll}
        tabIndex={0}
        aria-label="Discussion messages"
      >
        {notes && (
          <article className="tw-message tw-message-notes">
            <div className="tw-message-meta">
              <FileText size={12} />
              <strong>Task notes</strong>
            </div>
            <Markdown>{notes}</Markdown>
          </article>
        )}
        {loading && (
          <p className="tw-empty-copy" role="status">
            Loading discussion…
          </p>
        )}
        {error ? (
          <ErrorNotice
            error={error}
            onRetry={onRetry}
            label="Discussion could not load"
          />
        ) : null}
        {!loading && !error && !messages.length && (
          <div className="tw-conversation-empty">
            <span className="tw-empty-icon">
              <MessageSquare size={21} />
            </span>
            <h3>Start with the outcome.</h3>
            <p>
              Describe what should change. Ask questions and set the scope
              before you approve a build.
            </p>
          </div>
        )}
        {messages.map((message) => {
          const metadata = readMessageMetadata(message.metadata)
          const isUser = message.authorType === 'user'
          return (
            <article
              key={message.id}
              className={`tw-message ${isUser ? 'tw-message-user' : message.authorType === 'system' ? 'tw-message-system' : ''}`}
            >
              <div className="tw-message-meta">
                <span className={`tw-avatar ${isUser ? 'tw-avatar-user' : ''}`}>
                  {isUser ? (message.authorUserId === userId ? 'Y' : 'M') : 'P'}
                </span>
                <strong>
                  {isUser
                    ? message.authorUserId === userId
                      ? 'You'
                      : 'Project member'
                    : message.authorType === 'system'
                      ? 'Task update'
                      : 'Planner'}
                </strong>
                {metadata.mode === 'question' && <span>Question</span>}
                {metadata.mode === 'change' && <span>Change request</span>}
                <Time value={message.createdAt} />
              </div>
              {metadata.context?.repoUrl && (
                <div className="tw-message-context">
                  {repositoryName(metadata.context.repoUrl)}
                  {metadata.context.path ? ` / ${metadata.context.path}` : ''}
                  {metadata.context.line ? `:${metadata.context.line}` : ''}
                </div>
              )}
              <Markdown>{message.body}</Markdown>
            </article>
          )
        })}
      </div>
      {newMessages && (
        <button
          type="button"
          className="tw-new-messages tw-button"
          onClick={() => {
            const node = scrollRef.current
            if (node) node.scrollTop = node.scrollHeight
            nearBottom.current = true
            setNewMessages(false)
          }}
        >
          <ArrowDown size={13} />
          New messages
        </button>
      )}
    </div>
  )
}

export function ReviewComposer({
  inputRef,
  value,
  onChange,
  mode,
  onModeChange,
  hasReview,
  context,
  onContextChange,
  repositories,
  pending,
  disabled,
  changeDisabled,
  onSend,
}: {
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (value: string) => void
  mode: MessageMode
  onModeChange: (mode: MessageMode) => void
  hasReview: boolean
  context: ReviewContext
  onContextChange: (context: ReviewContext) => void
  repositories: string[]
  pending: boolean
  disabled: boolean
  changeDisabled: boolean
  onSend: () => void
}) {
  return (
    <form
      className="tw-composer"
      onSubmit={(event) => {
        event.preventDefault()
        if (!pending && !disabled && !(mode === 'change' && changeDisabled))
          onSend()
      }}
    >
      {hasReview && (
        <div className="tw-message-modes" aria-label="Review action">
          <button
            type="button"
            aria-pressed={mode === 'question'}
            onClick={() => onModeChange('question')}
          >
            Ask question
          </button>
          <button
            type="button"
            aria-pressed={mode === 'change'}
            disabled={changeDisabled}
            onClick={() => onModeChange('change')}
          >
            Request change
          </button>
        </div>
      )}
      {hasReview && (
        <div className="tw-context-tools">
          <label htmlFor="tw-review-repo">Review context</label>
          <select
            id="tw-review-repo"
            value={context.repoUrl ?? ''}
            onChange={(event) =>
              onContextChange(
                event.target.value ? { repoUrl: event.target.value } : {},
              )
            }
          >
            <option value="">All repositories</option>
            {repositories.map((repo) => (
              <option key={repo} value={repo}>
                {repositoryName(repo)}
              </option>
            ))}
          </select>
          {context.path && (
            <span className="tw-context-chip">
              <code>
                {context.path}
                {context.line ? `:${context.line}` : ''}
                {context.side === 'LEFT' ? ' (removed)' : ''}
              </code>
              <button
                type="button"
                className="tw-icon-button"
                aria-label="Clear file context"
                onClick={() => onContextChange({ repoUrl: context.repoUrl })}
              >
                <X size={12} />
              </button>
            </span>
          )}
        </div>
      )}
      <label className="tw-sr-only" htmlFor="tw-message-input">
        {hasReview
          ? mode === 'change'
            ? 'Requested change'
            : 'Your question'
          : 'Your message'}
      </label>
      <textarea
        ref={inputRef}
        id="tw-message-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        maxLength={20_000}
        placeholder={
          hasReview
            ? mode === 'change'
              ? 'Describe what should change in this pull request…'
              : 'Ask about the approach or a code change…'
            : 'Describe the outcome, ask a question, or add a detail…'
        }
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            if (!pending && !disabled && !(mode === 'change' && changeDisabled))
              onSend()
          }
        }}
      />
      <div className="tw-composer-footer">
        <span>
          {hasReview
            ? mode === 'change'
              ? 'Sending starts a revision of the existing PR.'
              : 'Questions get an explanation.'
            : 'Discuss first. You approve the build.'}
        </span>
        <button
          type="submit"
          className="tw-button tw-primary"
          disabled={
            !value.trim() ||
            pending ||
            disabled ||
            (mode === 'change' && changeDisabled)
          }
        >
          {pending ? (
            <LoaderCircle size={15} className="tw-spin" />
          ) : (
            <ArrowUp size={15} />
          )}
          {pending
            ? 'Sending…'
            : hasReview
              ? mode === 'change'
                ? 'Send change'
                : 'Ask'
              : 'Send'}
        </button>
      </div>
    </form>
  )
}

export function PlanPanel({
  plan,
  draftKey,
  pending,
  disabled,
  canStart,
  onStart,
  onApprove,
  onRequestChanges,
}: {
  plan: Pick<
    AgentRun,
    'id' | 'status' | 'planMd' | 'planVersion' | 'updatedAt'
  > | null
  draftKey: string
  pending: boolean
  disabled: boolean
  canStart: boolean
  onStart: () => void
  onApprove: (runId: string, version: number) => void
  onRequestChanges: (
    runId: string,
    version: number,
    feedback: string,
  ) => Promise<void>
}) {
  const feedback = useDraft(draftKey)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = plan?.status === 'plan_ready'
  if (!plan?.planMd)
    return (
      <div className="tw-paper tw-plan-empty">
        <span className="tw-eyebrow">The approach</span>
        <h2>
          {isActive(plan)
            ? 'Your plan is taking shape.'
            : 'A clear plan comes first.'}
        </h2>
        <p>
          {isActive(plan)
            ? 'The agent is reading the repositories and writing an approach. The plan will appear here.'
            : 'Use the discussion to set the outcome and limits. Then ask the agent to write the plan.'}
        </p>
        <div className="tw-plan-outline">
          <span>
            <span>01</span>Agree on the outcome
          </span>
          <span>
            <span>02</span>Review the approach
          </span>
          <span>
            <span>03</span>Approve the build
          </span>
        </div>
        <button
          type="button"
          className="tw-button tw-primary"
          onClick={onStart}
          disabled={pending || disabled || !canStart}
        >
          {pending || isActive(plan) ? (
            <LoaderCircle size={15} className="tw-spin" />
          ) : (
            <FileText size={15} />
          )}
          {isActive(plan) ? 'Writing plan…' : 'Write the plan'}
        </button>
        {!canStart && !plan && (
          <p className="tw-small">
            Link a repository in project settings to start planning.
          </p>
        )}
      </div>
    )
  return (
    <div className="tw-paper">
      <div className="tw-plan-heading">
        <span className="tw-eyebrow">
          {ready
            ? 'Ready for your decision'
            : plan.status === 'approved'
              ? 'Approved plan'
              : 'Previous plan'}
        </span>
        <span className="tw-version">Version {plan.planVersion}</span>
      </div>
      <div className="tw-plan-document">
        <Markdown>{plan.planMd}</Markdown>
      </div>
      <div className="tw-plan-date">
        Updated <Time value={plan.updatedAt} />
      </div>
      {ready ? (
        <div className="tw-plan-actions">
          <p>Approve version {plan.planVersion} to start implementation.</p>
          <div className="tw-action-row">
            <button
              type="button"
              className="tw-button tw-primary"
              disabled={pending || disabled}
              onClick={() => onApprove(plan.id, plan.planVersion)}
            >
              {pending ? (
                <LoaderCircle size={15} className="tw-spin" />
              ) : (
                <Check size={15} />
              )}
              Approve &amp; build
            </button>
            <button
              type="button"
              className="tw-button"
              disabled={pending || disabled}
              aria-expanded={editing}
              onClick={() => setEditing(!editing)}
            >
              Request changes
            </button>
          </div>
          {editing && (
            <form
              className="tw-plan-feedback"
              onSubmit={(event) => {
                event.preventDefault()
                if (!feedback.value.trim() || disabled || pending) return
                setError(null)
                void onRequestChanges(
                  plan.id,
                  plan.planVersion,
                  feedback.value.trim(),
                )
                  .then(() => {
                    feedback.update('')
                    setEditing(false)
                  })
                  .catch((failure: unknown) => setError(errorText(failure)))
              }}
            >
              <label htmlFor="tw-plan-feedback">
                What should change in version {plan.planVersion}?
              </label>
              <textarea
                id="tw-plan-feedback"
                rows={4}
                value={feedback.value}
                onChange={(event) => feedback.update(event.target.value)}
                required
                maxLength={20_000}
              />
              <button
                type="submit"
                className="tw-button"
                disabled={!feedback.value.trim() || pending || disabled}
              >
                {pending ? 'Sending…' : 'Send plan feedback'}
              </button>
              {error && <p role="alert">{error}</p>}
            </form>
          )}
        </div>
      ) : (
        <div className="tw-plan-status">
          <Check size={15} />
          <span>
            {plan.status === 'approved'
              ? `Version ${plan.planVersion} was approved. The build uses this plan.`
              : isActive(plan)
                ? 'The agent is revising this plan. Wait for the new version before approval.'
                : 'This plan is kept with your task.'}
          </span>
        </div>
      )}
    </div>
  )
}

function ReviewPanel({
  review,
  loading,
  fetching,
  error,
  hasReview,
  onRetry,
  onSelectContext,
}: {
  review: TaskReview | undefined
  loading: boolean
  fetching: boolean
  error: unknown
  hasReview: boolean
  onRetry: () => void
  onSelectContext: (context: ReviewContext) => void
}) {
  if (!hasReview)
    return (
      <div className="tw-paper tw-plan-empty">
        <span className="tw-eyebrow">The result</span>
        <h2>Your changes will be here.</h2>
        <p>
          After you approve a plan, the agent implements it and opens a pull
          request for each repository that changed.
        </p>
        <span className="tw-empty-icon">
          <GitPullRequest size={25} />
        </span>
        <p className="tw-small">
          Review the code here. Use GitHub to approve and merge each pull
          request.
        </p>
      </div>
    )
  return (
    <div className="tw-review">
      <div className="tw-review-heading">
        <div>
          <span className="tw-eyebrow">Review changes</span>
          <h2>From plan to pull request.</h2>
        </div>
        <button
          type="button"
          className="tw-icon-button"
          aria-label="Refresh pull requests"
          disabled={fetching}
          onClick={onRetry}
        >
          <RefreshCw size={15} className={fetching ? 'tw-spin' : ''} />
        </button>
      </div>
      <p className="tw-review-intro">
        Read the changes and select a line to ask about it. Request a change to
        update the same pull request.
      </p>
      {loading && (
        <div className="tw-paper" role="status">
          <LoaderCircle size={18} className="tw-spin" /> Loading pull requests
          from GitHub…
        </div>
      )}
      {error ? (
        <ErrorNotice
          error={error}
          onRetry={onRetry}
          label="Pull requests could not load"
        />
      ) : null}
      {review && !review.repositories.length && (
        <div className="tw-paper">
          <p>
            No pull request is available for this run. Check Activity for the
            run result.
          </p>
        </div>
      )}
      {review?.repositories.map((repository) => (
        <RepositoryReview
          key={repository.repoUrl}
          repository={repository}
          onSelectContext={onSelectContext}
        />
      ))}
    </div>
  )
}

function PlanHistory({
  history,
  currentMarkdown,
}: {
  history: TaskWorkflow['planHistory']
  currentMarkdown?: string | null
}) {
  const earlier = history.filter((plan) => plan.planMd !== currentMarkdown)
  if (!earlier.length) return null
  return (
    <details className="tw-plan-history">
      <summary>Earlier plan versions ({earlier.length})</summary>
      {earlier.map((plan) => (
        <details key={plan.id}>
          <summary>
            Version {plan.version} · <Time value={plan.createdAt} />
          </summary>
          <div className="tw-paper">
            <Markdown>{plan.planMd}</Markdown>
            {plan.feedback && (
              <div className="tw-plan-status">
                Requested change: {plan.feedback}
              </div>
            )}
          </div>
        </details>
      ))}
    </details>
  )
}

function RepositoryReview({
  repository: repo,
  onSelectContext,
}: {
  repository: ReviewRepository
  onSelectContext: (context: ReviewContext) => void
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const selected = repo.files.find((file) => file.path === selectedFile)
  return (
    <article className="tw-repo-review">
      <header>
        <div>
          <span className="tw-repo-name">
            <GitBranch size={13} />
            {repositoryName(repo.repoUrl)}
          </span>
          <h3>
            {repo.title ||
              (repo.prNumber
                ? `Pull request #${repo.prNumber}`
                : 'Repository result')}
          </h3>
        </div>
        <span className="tw-version">
          {repo.merged
            ? 'Merged'
            : repo.draft
              ? 'Draft'
              : repo.state === 'closed'
                ? 'Closed'
                : repo.state === 'open'
                  ? 'Open'
                  : 'Unavailable'}
        </span>
      </header>
      {repo.prUrl && (
        <a
          href={repo.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="tw-button tw-github-link"
        >
          Open in GitHub{repo.prNumber ? ` #${repo.prNumber}` : ''}
          <ExternalLink size={13} />
        </a>
      )}
      {repo.error && (
        <div className="tw-notice tw-notice-error" role="alert">
          <p>
            {repo.error}{' '}
            {repo.prUrl
              ? 'Open the pull request in GitHub to review it.'
              : 'Check repository access in project settings.'}
          </p>
        </div>
      )}
      {repo.truncated && (
        <p className="tw-review-limit">
          This preview has a size limit. Open GitHub for all files, checks, and
          comments.
        </p>
      )}
      {repo.body && (
        <details className="tw-pr-description">
          <summary>Pull request summary</summary>
          <Markdown>{repo.body}</Markdown>
        </details>
      )}
      {repo.headSha && (
        <>
          <div className="tw-pr-stats">
            <span>
              {repo.files.length} changed{' '}
              {repo.files.length === 1 ? 'file' : 'files'}
            </span>
            <span className="tw-additions">+{repo.additions}</span>
            <span className="tw-deletions">−{repo.deletions}</span>
            {repo.headSha && (
              <code title="Current PR commit">{repo.headSha.slice(0, 7)}</code>
            )}
          </div>
          <details className="tw-checks">
            <summary>
              Checks{' '}
              <span>
                {repo.checks.length
                  ? `${repo.checks.filter((check) => check.conclusion === 'success').length} of ${repo.checks.length} passed`
                  : 'No checks reported'}
              </span>
            </summary>
            <ul>
              {repo.checks.map((check, index) => (
                <li key={`${check.name}:${index}`}>
                  <span
                    className={`tw-check-dot ${check.conclusion === 'success' ? 'tw-check-pass' : check.conclusion === 'failure' || check.conclusion === 'cancelled' ? 'tw-check-fail' : ''}`}
                  />
                  {check.url ? (
                    <a
                      href={check.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {check.name}
                    </a>
                  ) : (
                    <span>{check.name}</span>
                  )}
                  <span>{check.conclusion ?? check.status}</span>
                </li>
              ))}
            </ul>
            {!repo.checks.length && (
              <p className="tw-small">
                GitHub did not report checks for this commit.
              </p>
            )}
          </details>
          {!!repo.files.length && (
            <div className="tw-files">
              <label htmlFor={`tw-files-${repo.prNumber ?? repo.repoUrl}`}>
                Changed file
              </label>
              <select
                id={`tw-files-${repo.prNumber ?? repo.repoUrl}`}
                value={selectedFile ?? ''}
                onChange={(event) =>
                  setSelectedFile(event.target.value || null)
                }
              >
                <option value="">Choose a file to read the diff</option>
                {repo.files.map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.path} (+{file.additions} −{file.deletions})
                  </option>
                ))}
              </select>
              {selected && (
                <div className="tw-file-diff">
                  <div className="tw-file-heading">
                    <code>{selected.path}</code>
                    <button
                      type="button"
                      className="tw-text-button"
                      onClick={() =>
                        onSelectContext({
                          repoUrl: repo.repoUrl,
                          headSha: repo.headSha,
                          path: selected.path,
                        })
                      }
                    >
                      Ask about file
                    </button>
                  </div>
                  {selected.patch ? (
                    <>
                      <p className="tw-small">
                        Select a line to add it to your question or change
                        request.
                      </p>
                      <Patch
                        patch={selected.patch}
                        onSelect={(line, side) =>
                          onSelectContext({
                            repoUrl: repo.repoUrl,
                            headSha: repo.headSha,
                            path: selected.path,
                            line,
                            side,
                          })
                        }
                      />
                    </>
                  ) : (
                    <p className="tw-small">
                      GitHub did not return a text diff for this file. Open the
                      pull request in GitHub to view it.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="tw-button tw-repo-question"
            onClick={() =>
              onSelectContext({ repoUrl: repo.repoUrl, headSha: repo.headSha })
            }
          >
            <MessageSquare size={14} />
            Ask about this repository
          </button>
        </>
      )}
      {!!repo.comments.length && (
        <details className="tw-pr-comments">
          <summary>
            {repo.comments.length} GitHub{' '}
            {repo.comments.length === 1 ? 'comment' : 'comments'}
          </summary>
          {repo.comments.map((comment) => (
            <article key={comment.id}>
              <div className="tw-message-meta">
                <strong>{comment.author}</strong>
                {comment.path && (
                  <code>
                    {comment.path}
                    {comment.line ? `:${comment.line}` : ''}
                  </code>
                )}
              </div>
              <Markdown>{comment.body}</Markdown>
              {comment.url && (
                <a
                  href={comment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tw-small"
                >
                  Open comment <ExternalLink size={11} />
                </a>
              )}
            </article>
          ))}
        </details>
      )}
    </article>
  )
}

function Patch({
  patch,
  onSelect,
}: {
  patch: string
  onSelect: (line: number, side: 'LEFT' | 'RIGHT') => void
}) {
  return (
    <div className="tw-patch" tabIndex={0} aria-label="Code diff">
      <div>
        {parsePatch(patch).map((line, index) => {
          const number = line.kind === 'removed' ? line.oldLine : line.newLine
          const children: ReactNode = (
            <>
              <span className="tw-line-number">{line.oldLine ?? ''}</span>
              <span className="tw-line-number">{line.newLine ?? ''}</span>
              <code>{line.text || ' '}</code>
            </>
          )
          return number === undefined ? (
            <div key={index} className={`tw-patch-line tw-patch-${line.kind}`}>
              {children}
            </div>
          ) : (
            <button
              key={index}
              type="button"
              className={`tw-patch-line tw-patch-${line.kind}`}
              aria-label={`Discuss ${line.kind === 'removed' ? 'removed' : 'new'} line ${number}: ${line.text}`}
              onClick={() =>
                onSelect(number, line.kind === 'removed' ? 'LEFT' : 'RIGHT')
              }
            >
              {children}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ActivityPanel({ runs }: { runs: Array<AgentRun | null> }) {
  const uniqueRuns = runs.filter(
    (run, index): run is AgentRun =>
      !!run && runs.findIndex((item) => item?.id === run.id) === index,
  )
  return (
    <div className="tw-paper tw-activity">
      <span className="tw-eyebrow">Task activity</span>
      <h2>The work, as it happens.</h2>
      {!uniqueRuns.length && (
        <p>No agent run has started. The first run will appear here.</p>
      )}
      {uniqueRuns.map((run) => (
        <section key={run.id}>
          <div className="tw-activity-heading">
            <div>
              <strong>
                {run.kind === 'plan'
                  ? 'Plan'
                  : run.kind === 'answer'
                    ? 'Answer'
                    : 'Implementation'}
              </strong>
              <span className="tw-version">
                {run.status.replaceAll('_', ' ')}
              </span>
            </div>
            <Time value={run.createdAt} />
          </div>
          {run.errorMessage && (
            <p className="tw-activity-error">{run.errorMessage}</p>
          )}
          {run.runnerJobUrl && (
            <a
              className="tw-text-button"
              href={run.runnerJobUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open runner job <ExternalLink size={12} />
            </a>
          )}
          <RunLogs logs={run.logs} />
        </section>
      ))}
    </div>
  )
}

function RunLogs({ logs }: { logs: string | null }) {
  let entries: Array<{ t: number; level: string; message: string }> = []
  try {
    const parsed: unknown = logs ? JSON.parse(logs) : []
    if (Array.isArray(parsed))
      entries = parsed.filter(
        (item): item is { t: number; level: string; message: string } =>
          !!item &&
          typeof item === 'object' &&
          typeof item.t === 'number' &&
          typeof item.level === 'string' &&
          typeof item.message === 'string',
      )
  } catch {
    /* A corrupt log must not prevent access to the task. */
  }
  if (!entries.length) return <p className="tw-small">No log entries yet.</p>
  return (
    <details className="tw-run-logs">
      <summary>{entries.length} log entries</summary>
      <ol>
        {entries.map((entry, index) => (
          <li key={`${entry.t}:${index}`}>
            <Time value={entry.t} />
            <pre className={entry.level === 'error' ? 'tw-activity-error' : ''}>
              {entry.message}
            </pre>
          </li>
        ))}
      </ol>
    </details>
  )
}
