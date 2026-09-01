import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskModal } from './TaskModal'

vi.mock('#/lib/queries', () => ({
  useTask: () => ({ data: undefined }),
  useUpdateTaskMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateTaskMutation: () => ({ mutate: vi.fn(), isPending: false }),
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
  vi.unstubAllGlobals()
})

describe('TaskModal', () => {
  it('clears the previous draft when opening another new task', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })

    const { rerender } = render(<TaskModal taskId={null} projectId="project-1" onClose={vi.fn()} />)
    const notes = screen.getByPlaceholderText(/Describe what needs to happen/) as HTMLTextAreaElement
    fireEvent.change(notes, { target: { value: 'First task notes' } })
    expect(notes.value).toBe('First task notes')

    rerender(<TaskModal taskId={null} projectId={null} onClose={vi.fn()} />)
    expect(screen.queryByPlaceholderText(/Describe what needs to happen/)).toBeNull()

    rerender(<TaskModal taskId={null} projectId="project-1" onClose={vi.fn()} />)
    await waitFor(() => {
      expect((screen.getByPlaceholderText(/Describe what needs to happen/) as HTMLTextAreaElement).value).toBe('')
    })
  })
})
