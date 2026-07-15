import { useEffect, useRef, useState } from 'react'
import { X, Plus, Upload, FileText, Image } from 'lucide-react'
import {
  useTask,
  useUpdateTaskMutation,
  useCreateTaskMutation,
  useCompleteTaskMutation,
  useDeleteTaskMutation,
  useUploadAttachmentMutation,
  useDeleteAttachmentMutation,
} from '#/lib/queries'
import { useUI } from '#/lib/ui-context'
import type { Attachment, Task } from '#/lib/queries'

interface TaskModalProps {
  taskId: string | null
  projectId: string | null
  projectName?: string | null
  projectRepoUrl?: string | null
  onClose: () => void
  onOpenProject?: (projectId: string) => void
  onTaskSaved?: (taskId: string) => void
}

type Draft = {
  title: string
  notes: string
  priority: Task['priority']
  dueAt: string // datetime-local string, '' for none
}

const INITIAL_DRAFT: Draft = {
  title: '',
  notes: '',
  priority: 'medium',
  dueAt: '',
}

export function TaskModal(props: TaskModalProps) {
  const { taskId, projectId, projectName, projectRepoUrl, onClose } = props
  const isOpen = !!taskId || !!projectId
  const ui = useUI()
  const [draft, setDraft] = useState<Draft>(INITIAL_DRAFT)
  const [fadeClass, setFadeClass] = useState<'closed' | 'open'>('closed')
  const titleRef = useRef<HTMLInputElement>(null)
  const notesRef = useRef<HTMLTextAreaElement>(null)

  // Fetch the task when editing an existing one.
  const taskRes = useTask(taskId ?? '')
  const task = taskRes.data
  const [seenId, setSeenId] = useState<string | null>(null)

  const updateMut = useUpdateTaskMutation()
  const createMut = useCreateTaskMutation()
  const completeMut = useCompleteTaskMutation()
  const deleteMut = useDeleteTaskMutation()

  // Sync draft when the fetched task changes.
  useEffect(() => {
    if (taskId && taskId !== seenId && task) {
      setSeenId(taskId)
      setDraft({
        title: task.title,
        notes: task.notes ?? '',
        priority: task.priority,
        dueAt: task.dueAt ? toDatetimeLocal(task.dueAt) : '',
      })
    } else if (!taskId && projectId && seenId !== null) {
      // switching from existing task → new-task mode
      setSeenId(null)
      setDraft(INITIAL_DRAFT)
    } else if (!taskId && !projectId && seenId !== null) {
      setSeenId(null)
      setDraft(INITIAL_DRAFT)
    }
  }, [taskId, projectId, seenId, task])

  // Open/close fade — track open state on a small delay so React can paint
  // the initial closed frame, then promote to open to trigger the CSS transition.
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setFadeClass('open'))
      setTimeout(() => titleRef.current?.focus(), 80)
    } else {
      setFadeClass('closed')
    }
  }, [isOpen])

  // Esc to close.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const isExisting = !!taskId
  const isNew = !isExisting

  const handleSave = () => {
    const trimmedTitle = draft.title.trim()
    if (!trimmedTitle) {
      titleRef.current?.focus()
      return
    }
    const dueAt = draft.dueAt ? Date.parse(draft.dueAt) : null
    if (isExisting && taskId) {
      updateMut.mutate(
        {
          data: {
            id: taskId,
            title: trimmedTitle,
            notes: draft.notes ?? null,
            priority: draft.priority,
            dueAt: Number.isFinite(dueAt) ? dueAt : null,
          },
        },
        {
          onSuccess: (saved) => {
            onClose()
            if (saved) props.onTaskSaved?.(saved.id)
          },
        },
      )
    } else if (isNew && projectId) {
      createMut.mutate(
        {
          data: {
            projectId,
            title: trimmedTitle,
            notes: draft.notes || null,
            priority: draft.priority,
            dueAt: Number.isFinite(dueAt) ? dueAt : undefined,
          },
        },
        {
          onSuccess: (created) => {
            onClose()
            if (created) props.onTaskSaved?.(created.id)
          },
        },
      )
    }
  }

  const handleMarkDone = () => {
    if (!taskId) return
    completeMut.mutate(
      { data: { id: taskId } },
      { onSuccess: () => onClose() },
    )
  }

  const handleDelete = async () => {
    if (!taskId) return
    const confirmed = await ui.requestConfirm({
      title: 'Delete this task?',
      message: 'This cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    deleteMut.mutate(
      { data: { id: taskId } },
      { onSuccess: () => onClose() },
    )
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!taskId) return
    const items = e.clipboardData.items
    let hasImage = false
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        hasImage = true
        const file = item.getAsFile()
        if (file) {
          const formData = new FormData()
          formData.append('taskId', taskId)
          formData.append('file', file, file.name || 'pasted-image.png')
          uploadMut.mutate({ data: formData })
        }
      }
    }
    if (hasImage) {
      e.preventDefault()
    }
  }

  const subtasks = task?.subtasks ?? []

  return (
    <div
      className={`modal-backdrop ${fadeClass === 'open' ? 'open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <input
            ref={titleRef}
            className="title-input"
            placeholder="Task title…"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave()
            }}
          />
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field-group">
            <div className="field-label">Notes</div>
            <textarea
              ref={notesRef}
              className="notes-input"
              placeholder="Context for you and the agent…"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              onPaste={handlePaste}
            />
            {isExisting && (
              <div className="paste-hint">
                <Image size={12} />
                Paste an image here to attach it
              </div>
            )}
          </div>

          {isExisting && taskId && (
            <div className="field-group">
              <div className="field-label">Attachments</div>
              <AttachmentSection taskId={taskId} attachments={task?.attachments ?? []} />
            </div>
          )}

{isExisting && (
            <div className="field-group">
              <div className="field-label">Subtasks</div>
              <div className="subtasks-list">
                {subtasks.map((s) => (
                  <SubtaskRow key={s.id} subtask={s} />
                ))}
              </div>
              <NewSubtaskRow parentId={taskId!} projectId={task?.projectId ?? projectId ?? ''} />
            </div>
          )}

          <div className="field-group">
            <div className="field-label">Priority & due</div>
            <div className="controls-row">
              <select
                className="ctrl-select"
                value={draft.priority}
                onChange={(e) =>
                  setDraft({ ...draft, priority: e.target.value as Task['priority'] })
                }
              >
                <option value="urgent">urgent</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
              <input
                className="ctrl-input"
                type="datetime-local"
                value={draft.dueAt}
                onChange={(e) => setDraft({ ...draft, dueAt: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <div className="left">
            <span
              className="proj-link"
              onClick={() => {
                if (task?.projectId && props.onOpenProject) {
                  props.onOpenProject(task.projectId)
                  onClose()
                }
              }}
              role="button"
              tabIndex={0}
            >
              {projectName ?? ''}{projectRepoUrl ? ` · ${projectRepoUrl.replace(/^https?:\/\//, '')}` : ''}
            </span>
          </div>
          <div className="right">
            {isExisting && (
              <>
                <button className="btn btn-ghost" onClick={handleDelete}>
                  Delete
                </button>
                <button className="btn btn-ghost" onClick={handleMarkDone}>
                  Mark done
                </button>
              </>
            )}
            <button className="btn btn-primary" onClick={handleSave}>
              {isNew ? 'Create' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function NewSubtaskRow({ parentId, projectId }: { parentId: string; projectId: string }) {
  const createMut = useCreateTaskMutation()
  const [title, setTitle] = useState('')
  const [show, setShow] = useState(false)

  if (!show) {
    return (
      <span className="add-subtask" onClick={() => setShow(true)} role="button" tabIndex={0}>
        + add subtask
      </span>
    )
  }
  return (
    <div className="subtask-row" style={{ background: 'transparent' }}>
      <div className="check" style={{ borderColor: 'var(--line-2)' }} />
      <input
        className="st-input"
        placeholder="Subtask title…"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (title.trim().length) {
              createMut.mutate(
                { data: { projectId, parentId, title: title.trim(), priority: 'low' } },
                { onSuccess: () => setTitle('') },
              )
            }
          } else if (e.key === 'Escape') {
            setShow(false)
            setTitle('')
          }
        }}
        onBlur={() => {
          if (!title.trim()) {
            setShow(false)
          } else {
            createMut.mutate({ data: { projectId, parentId, title: title.trim(), priority: 'low' } })
            setTitle('')
            setShow(false)
          }
        }}
      />
      <Plus size={12} style={{ color: 'var(--g-500)' }} />
    </div>
  )
}

function SubtaskRow({ subtask }: { subtask: Task }) {
  const completeMut = useCompleteTaskMutation()
  const uncompleteMut = useUpdateTaskMutation()
  const deleteMut = useDeleteTaskMutation()
  const ui = useUI()
  const isDone = subtask.status === 'done'

  return (
    <div className={`subtask-row ${isDone ? 'done' : ''}`}>
      <div
        className={`check ${isDone ? 'done' : ''}`}
        onClick={() => {
          if (!isDone) {
            completeMut.mutate({ data: { id: subtask.id } })
          } else {
            uncompleteMut.mutate({
              data: { id: subtask.id, status: 'todo' },
            })
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={isDone ? 'Restore subtask' : 'Complete subtask'}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (!isDone) completeMut.mutate({ data: { id: subtask.id } })
            else uncompleteMut.mutate({ data: { id: subtask.id, status: 'todo' } })
          }
        }}
      />
      <input
        className="st-input"
        value={subtask.title}
        onChange={() => {
          /* title edits can be added later via useUpdateTaskMutation */
        }}
        readOnly
      />
      <span
        className="del"
        onClick={async () => {
          const confirmed = await ui.requestConfirm({
            title: 'Delete subtask?',
            message: 'This cannot be undone.',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            destructive: true,
          })
          if (confirmed) deleteMut.mutate({ data: { id: subtask.id } })
        }}
        role="button"
        tabIndex={0}
        aria-label="Delete subtask"
      >
        ×
      </span>
    </div>
  )
}

function AttachmentSection({ taskId, attachments }: { taskId: string; attachments: Attachment[] }) {
  const uploadMut = useUploadAttachmentMutation()
  const deleteMut = useDeleteAttachmentMutation()
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach((file) => {
      const formData = new FormData()
      formData.append('taskId', taskId)
      formData.append('file', file)
      uploadMut.mutate({ data: formData })
    })
  }

  return (
    <div className="attachments-section">
      {attachments.length > 0 && (
        <div className="attachments-list">
          {attachments.map((a) => (
            <AttachmentRow key={a.id} attachment={a} onDelete={() => deleteMut.mutate({ data: { id: a.id } })} />
          ))}
        </div>
      )}
      <button
        className="btn btn-ghost attachment-add"
        onClick={() => fileRef.current?.click()}
        disabled={uploadMut.isPending}
      >
        <Upload size={14} />
        {uploadMut.isPending ? 'Uploading…' : 'Upload file'}
      </button>
      <input
        ref={fileRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  )
}

function AttachmentRow({ attachment, onDelete }: { attachment: Attachment; onDelete: () => void }) {
  const isImage = attachment.mimeType.startsWith('image/')

  return (
    <div className="attachment-row">
      <a
        className="attachment-info"
        href={`/api/attachments/${attachment.id}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {isImage ? (
          <img
            src={`/api/attachments/${attachment.id}`}
            alt={attachment.name}
            className="attachment-thumb"
          />
        ) : (
          <div className="attachment-icon">
            {attachment.mimeType.startsWith('image/') ? <Image size={16} /> : <FileText size={16} />}
          </div>
        )}
        <span className="attachment-name">{attachment.name}</span>
        <span className="attachment-size">{formatBytes(attachment.size)}</span>
      </a>
      <button
        className="attachment-delete"
        onClick={onDelete}
        aria-label="Delete attachment"
        title="Delete attachment"
      >
        <X size={12} />
      </button>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function toDatetimeLocal(ms: number): string {
  const d = new Date(ms)
  const tzOffset = d.getTimezoneOffset() * 60_000
  const local = new Date(d.getTime() - tzOffset)
  return local.toISOString().slice(0, 16)
}