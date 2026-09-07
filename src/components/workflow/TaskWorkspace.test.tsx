import { useState } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlanPanel, ReviewComposer } from './TaskWorkspace'
import { parsePatch, readMessageMetadata } from './task-workspace-model'

vi.mock('#/server/agent', () => ({
  approvePlan: vi.fn(),
  planTask: vi.fn(),
  requestPlanChanges: vi.fn(),
  retryAgentRun: vi.fn(),
  stopAgentRun: vi.fn(),
}))
vi.mock('#/server/chat', () => ({
  markTaskChatRead: vi.fn(),
  sendTaskMessage: vi.fn(),
}))
vi.mock('#/server/attachments', () => ({ uploadAttachment: vi.fn() }))
vi.mock('#/lib/queries', () => ({
  attachmentsQueryOptions: vi.fn(),
  taskChatQueryOptions: vi.fn(),
  qk: {},
}))
vi.mock('#/lib/task-workspace-queries', () => ({
  taskWorkflowQueryOptions: vi.fn(),
  taskReviewQueryOptions: vi.fn(),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const plan = {
  id: 'plan-one',
  status: 'plan_ready' as const,
  planMd: '# Export invoices\n\nKeep the current filters.',
  planVersion: 4,
  updatedAt: 1_788_624_000_000,
}
const planProps = {
  plan,
  draftKey: 'feedback:user:task:4',
  pending: false,
  disabled: false,
  canStart: true,
  onStart: vi.fn(),
  onApprove: vi.fn(),
  onRequestChanges: vi.fn().mockResolvedValue(undefined),
}

describe('Task plan decision', () => {
  it('approves the exact displayed version and prevents approval while a request is pending', () => {
    const onApprove = vi.fn()
    const { rerender } = render(
      <PlanPanel {...planProps} onApprove={onApprove} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Approve & build' }))
    expect(onApprove).toHaveBeenCalledWith('plan-one', 4)
    rerender(<PlanPanel {...planProps} onApprove={onApprove} pending />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve & build' }))
    expect(onApprove).toHaveBeenCalledTimes(1)
    rerender(
      <PlanPanel
        {...planProps}
        plan={{ ...plan, status: 'running', planVersion: 5 }}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Approve & build' })).toBeNull()
  })

  it('keeps feedback after a stale plan error, without approving or starting code', async () => {
    const onRequestChanges = vi
      .fn()
      .mockRejectedValue(new Error('The plan changed. Reload it.'))
    const onApprove = vi.fn()
    render(
      <PlanPanel
        {...planProps}
        onRequestChanges={onRequestChanges}
        onApprove={onApprove}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Keep the invoice date.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send plan feedback' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'The plan changed',
      ),
    )
    expect(onRequestChanges).toHaveBeenCalledWith(
      'plan-one',
      4,
      'Keep the invoice date.',
    )
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Keep the invoice date.',
    )
    expect(localStorage.getItem(planProps.draftKey)).toBe(
      'Keep the invoice date.',
    )
    expect(onApprove).not.toHaveBeenCalled()
  })
})

describe('PR review actions', () => {
  it('keeps questions and change requests distinct and disables changes on closed PRs', () => {
    const send = vi.fn()
    function Composer({ closed = false }: { closed?: boolean }) {
      const [mode, setMode] = useState<'discuss' | 'question' | 'change'>(
        'question',
      )
      return (
        <ReviewComposer
          value="Why does this change the API?"
          onChange={vi.fn()}
          mode={mode}
          onModeChange={setMode}
          hasReview
          context={{
            repoUrl: 'https://github.com/team/api',
            path: 'src/export.ts',
            line: 12,
            side: 'RIGHT',
          }}
          onContextChange={vi.fn()}
          repositories={['https://github.com/team/api']}
          pending={false}
          disabled={false}
          changeDisabled={closed}
          onSend={() => send(mode)}
        />
      )
    }
    const { rerender } = render(<Composer />)
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/ }))
    expect(send).toHaveBeenLastCalledWith('question')
    fireEvent.click(screen.getByRole('button', { name: 'Request change' }))
    expect(send).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Send change' }))
    expect(send).toHaveBeenLastCalledWith('change')
    expect(screen.getByText('src/export.ts:12')).not.toBeNull()
    rerender(<Composer closed />)
    fireEvent.click(screen.getByRole('button', { name: 'Send change' }))
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('maps removed and added diff lines to the correct source line', () => {
    const lines = parsePatch(
      '@@ -10,3 +20,4 @@\n context\n-old\n+new\n+extra\n end\n@@ -80 +92 @@\n-before\n+after',
    )
    expect(lines[2]).toEqual({ text: '-old', kind: 'removed', oldLine: 11 })
    expect(lines[3]).toEqual({ text: '+new', kind: 'added', newLine: 21 })
    expect(lines[5]).toEqual({
      text: ' end',
      kind: 'context',
      oldLine: 12,
      newLine: 23,
    })
    expect(lines[8]).toEqual({ text: '+after', kind: 'added', newLine: 92 })
  })

  it('reads stored PR context and ignores invalid metadata', () => {
    expect(readMessageMetadata('{broken')).toEqual({})
    const metadata = readMessageMetadata(
      JSON.stringify({
        mode: 'change',
        review: {
          context: {
            repoUrl: 'https://github.com/team/api',
            path: 'src/export.ts',
            line: 12,
            side: 'LEFT',
            headSha: 'a'.repeat(40),
          },
        },
      }),
    )
    expect(metadata.mode).toBe('change')
    expect(metadata.context?.side).toBe('LEFT')
    expect(metadata.context?.headSha).toBe('a'.repeat(40))
  })
})
