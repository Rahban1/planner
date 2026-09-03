import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskModal } from './TaskModal'

const { createTask } = vi.hoisted(() => ({ createTask: vi.fn() }))

vi.mock('#/lib/queries', () => ({
  useTask: () => ({ data: undefined }),
  useUpdateTaskMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateTaskMutation: () => ({ mutate: createTask, isPending: false }),
  useCompleteTaskMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useUncompleteTaskMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTaskMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateTaskFromMessageMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadAttachmentMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAttachmentMutation: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('#/lib/ui-context', () => ({
  useUI: () => ({ requestConfirm: vi.fn() }),
}))

afterEach(() => {
  cleanup()
  createTask.mockClear()
  vi.unstubAllGlobals()
})

describe('TaskModal', () => {
  it('uses the structured task form for a new task', () => {
    render(
      <TaskModal taskId={null} projectId="project-1" onClose={vi.fn()} />,
    )

    fireEvent.change(screen.getByPlaceholderText('Task title…'), {
      target: { value: 'Structured task' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Context for you and the agent/), {
      target: { value: 'Task notes' },
    })
    fireEvent.change(screen.getByLabelText('Task priority'), {
      target: { value: 'high' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(createTask).toHaveBeenCalledWith(
      {
        data: {
          projectId: 'project-1',
          title: 'Structured task',
          notes: 'Task notes',
          priority: 'high',
          dueAt: undefined,
        },
      },
      expect.any(Object),
    )
    expect(screen.getByLabelText('Task due date')).not.toBeNull()
    expect(screen.getByLabelText('Task due date').closest('.task-modal')).not.toBeNull()
  })

  it('clears the previous draft when opening another new task', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })

    const { rerender } = render(<TaskModal taskId={null} projectId="project-1" onClose={vi.fn()} />)
    const title = screen.getByPlaceholderText('Task title…') as HTMLInputElement
    const notes = screen.getByPlaceholderText(/Context for you and the agent/) as HTMLTextAreaElement
    fireEvent.change(title, { target: { value: 'First task title' } })
    fireEvent.change(notes, { target: { value: 'First task notes' } })
    expect(title.value).toBe('First task title')
    expect(notes.value).toBe('First task notes')

    rerender(<TaskModal taskId={null} projectId={null} onClose={vi.fn()} />)
    expect(screen.queryByPlaceholderText('Task title…')).toBeNull()

    rerender(<TaskModal taskId={null} projectId="project-1" onClose={vi.fn()} />)
    await waitFor(() => {
      expect((screen.getByPlaceholderText('Task title…') as HTMLInputElement).value).toBe('')
      expect((screen.getByPlaceholderText(/Context for you and the agent/) as HTMLTextAreaElement).value).toBe('')
    })
  })
})
