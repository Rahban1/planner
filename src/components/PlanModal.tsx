import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Send,
  X,
  Users,
  ThumbsUp,
  ThumbsDown,
  Lightbulb,
} from 'lucide-react'
import { marked } from 'marked'
import {
  useApprovePlanMutation,
  usePlanRunForTask,
  useRequestPlanChangesMutation,
  useTask,
  usePlanApprovals,
  usePlanSuggestions,
  useRequestPlanApprovalMutation,
  useRespondToApprovalMutation,
  useAddPlanSuggestionMutation,
} from '#/lib/queries'
import { useUI } from '#/lib/ui-context'

export function PlanModal() {
  const ui = useUI()
  const taskId = ui.planModal?.taskId ?? null
  const isOpen = !!taskId

  const taskRes = useTask(taskId ?? '')
  const planRes = usePlanRunForTask(taskId ?? '')
  const run = planRes.data
  const runId = run?.id ?? ''

  const approveMut = useApprovePlanMutation()
  const changesMut = useRequestPlanChangesMutation()
  const approvalsRes = usePlanApprovals(runId)
  const suggestionsRes = usePlanSuggestions(runId)
  const requestApprovalMut = useRequestPlanApprovalMutation()
  const respondApprovalMut = useRespondToApprovalMutation()
  const addSuggestionMut = useAddPlanSuggestionMutation()

  const [fadeClass, setFadeClass] = useState<'closed' | 'open'>('closed')
  const [feedback, setFeedback] = useState('')
  const [approvalEmail, setApprovalEmail] = useState('')
  const [suggestionText, setSuggestionText] = useState('')
  const [activeTab, setActiveTab] = useState<'review' | 'suggestions' | 'approvals'>('review')

  const status = run?.status
  const isPlanning = status === 'queued' || status === 'running'
  const isReady = status === 'plan_ready'
  const isApproved = status === 'approved'
  const busy = approveMut.isPending || changesMut.isPending

  const approvals = approvalsRes.data ?? []
  const suggestions = suggestionsRes.data ?? []
  const pendingApprovals = approvals.filter((a) => a.status === 'pending')
  const approvedCount = approvals.filter((a) => a.status === 'approved').length

  const planHtml = useMemo(() => {
    if (!run?.planMd) return null
    try {
      return marked.parse(run.planMd, { async: false }) as string
    } catch {
      return null
    }
  }, [run?.planMd])

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setFadeClass('open'))
    } else {
      setFadeClass('closed')
      setFeedback('')
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ui.closePlan()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, ui])

  if (!isOpen || !taskId) return null

  const task = taskRes.data

  const submitChanges = () => {
    const trimmed = feedback.trim()
    if (!trimmed || !run) return
    changesMut.mutate(
      { data: { runId: run.id, feedback: trimmed } },
      { onSuccess: () => setFeedback('') },
    )
  }

  const submitApprovalRequest = () => {
    const trimmed = approvalEmail.trim()
    if (!trimmed || !run) return
    requestApprovalMut.mutate(
      {
        data: {
          agentRunId: run.id,
          projectId: run.projectId,
          requestedBy: 'user@planner.local', // placeholder until auth is added
          requestedFrom: trimmed,
        },
      },
      { onSuccess: () => setApprovalEmail('') },
    )
  }

  const submitSuggestion = () => {
    const trimmed = suggestionText.trim()
    if (!trimmed || !run) return
    addSuggestionMut.mutate(
      {
        data: {
          agentRunId: run.id,
          projectId: run.projectId,
          suggestedBy: 'user@planner.local', // placeholder until auth is added
          content: trimmed,
        },
      },
      { onSuccess: () => setSuggestionText('') },
    )
  }

  return (
    <div
      className={`modal-backdrop ${fadeClass === 'open' ? 'open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) ui.closePlan()
      }}
    >
      <div className="modal plan-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="arm-title-wrap">
            <div className="arm-eyebrow">
              <ClipboardList size={13} />
              <span>Plan review</span>
            </div>
            <div className="arm-title">{task?.title ?? '…'}</div>
          </div>
          <div className="arm-head-right">
            {run && (
              <span className={`arm-status ${isReady ? 'plan' : ''} ${isApproved ? 'merged' : ''} ${isPlanning ? 'running' : ''}`}>
                {isPlanning ? <Loader2 size={12} className="spin" /> : isApproved ? <CheckCircle2 size={12} /> : <ClipboardList size={12} />}
                <span>
                  {isPlanning
                    ? `Planning v${run.planVersion}…`
                    : isReady
                      ? `Plan v${run.planVersion} · awaiting review`
                      : isApproved
                        ? `Plan v${run.planVersion} · approved`
                        : `Plan v${run.planVersion}`}
                </span>
              </span>
            )}
            <button className="modal-close" onClick={ui.closePlan} aria-label="Close">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {!run ? (
            <div className="arm-logs-empty">No plan run yet for this task.</div>
          ) : isPlanning ? (
            <div className="plan-waiting">
              <Loader2 size={20} className="spin" />
              <p>
                {run.planVersion > 1
                  ? 'The agent is revising the plan based on your feedback…'
                  : 'The agent is exploring the repo and drafting a plan…'}
              </p>
              <p className="plan-waiting-hint">This usually takes a few minutes. The plan will appear here when it is ready.</p>
            </div>
          ) : (
            <>
              {isApproved && (
                <div className="plan-approved-banner">
                  <CheckCircle2 size={14} />
                  <span>Approved — implementation has been queued. The agent will follow this plan.</span>
                </div>
              )}
              {planHtml ? (
                <div
                  className="plan-md"
                  // Plan markdown is generated by our own agent run and rendered locally.
                  dangerouslySetInnerHTML={{ __html: planHtml }}
                />
              ) : (
                <div className="arm-logs-empty">This run has no plan content.</div>
              )}
            </>
          )}
        </div>

        {isReady && (
          <div className="plan-review-foot">
            <div className="plan-review-toolbar">
              <div className="plan-review-tabs" role="tablist" aria-label="Plan review sections">
                {([
                  { key: 'review', label: 'Review', icon: <ClipboardList size={13} /> },
                  { key: 'suggestions', label: `Suggestions (${suggestions.length})`, icon: <Lightbulb size={13} /> },
                  { key: 'approvals', label: `Approvals (${approvedCount}/${approvals.length})`, icon: <Users size={13} /> },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    className={`plan-review-tab ${activeTab === tab.key ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab.key)}
                    role="tab"
                    aria-selected={activeTab === tab.key}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === 'review' && (
                <div className="plan-review-actions">
                  <button className="btn btn-ghost" onClick={ui.closePlan}>
                    Review later
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => run && approveMut.mutate({ data: { runId: run.id } })}
                    disabled={busy}
                  >
                    <Check size={14} />
                    {approveMut.isPending ? 'Approving…' : 'Approve & implement'}
                  </button>
                </div>
              )}
            </div>

            {activeTab === 'review' && (
              <div className="plan-feedback-wrap">
                <textarea
                  className="plan-feedback"
                  placeholder="Suggest changes… (the agent will revise the plan)"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitChanges()
                  }}
                />
                <button
                  className="btn btn-ghost plan-send"
                  onClick={submitChanges}
                  disabled={busy || !feedback.trim()}
                  title="Send feedback and request a revised plan"
                >
                  <Send size={13} />
                  {changesMut.isPending ? 'Sending…' : 'Request changes'}
                </button>
              </div>
            )}

            {activeTab === 'suggestions' && (
              <div style={{ padding: '0 26px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Add suggestion */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <textarea
                    className="plan-feedback"
                    placeholder="Share a suggestion or idea for the plan…"
                    value={suggestionText}
                    onChange={(e) => setSuggestionText(e.target.value)}
                    style={{ flex: 1, minHeight: 60 }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={submitSuggestion}
                    disabled={addSuggestionMut.isPending || !suggestionText.trim()}
                    style={{ alignSelf: 'flex-end' }}
                  >
                    <Lightbulb size={13} />
                    Suggest
                  </button>
                </div>

                {/* Suggestion list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                  {suggestions.map((s) => (
                    <div
                      key={s.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--line)',
                        background: 'rgba(242,244,243,0.03)',
                      }}
                    >
                      <div style={{ fontSize: 11, color: 'var(--g-700)', marginBottom: 4 }}>
                        {s.suggestedBy} · {new Date(s.createdAt).toLocaleDateString()}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--g-1000)', lineHeight: 1.5 }}>
                        {s.content}
                      </div>
                    </div>
                  ))}
                  {suggestions.length === 0 && (
                    <div className="serif italic" style={{ color: 'var(--g-700)', padding: '8px 0' }}>
                      No suggestions yet. Be the first to share an idea.
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'approvals' && (
              <div style={{ padding: '0 26px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Request approval */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="email"
                    placeholder="Request approval from (email)…"
                    value={approvalEmail}
                    onChange={(e) => setApprovalEmail(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--line-2)',
                      background: 'rgba(242,244,243,0.04)',
                      color: 'var(--g-1000)',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={submitApprovalRequest}
                    disabled={requestApprovalMut.isPending || !approvalEmail.trim()}
                  >
                    <Users size={13} />
                    Request
                  </button>
                </div>

                {/* Approval list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                  {approvals.map((a) => (
                    <div
                      key={a.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--line)',
                        background: 'rgba(242,244,243,0.03)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--g-1000)' }}>
                          {a.requestedFrom}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--g-700)' }}>
                          Requested by {a.requestedBy} · {a.status}
                        </div>
                      </div>
                      {a.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-ghost"
                            onClick={() => respondApprovalMut.mutate({ data: { id: a.id, status: 'approved' } })}
                            disabled={respondApprovalMut.isPending}
                            style={{ color: 'var(--accent)' }}
                          >
                            <ThumbsUp size={14} />
                          </button>
                          <button
                            className="btn btn-ghost"
                            onClick={() => respondApprovalMut.mutate({ data: { id: a.id, status: 'rejected' } })}
                            disabled={respondApprovalMut.isPending}
                            style={{ color: '#e57373' }}
                          >
                            <ThumbsDown size={14} />
                          </button>
                        </div>
                      )}
                      {a.status === 'approved' && (
                        <span style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <ThumbsUp size={12} /> Approved
                        </span>
                      )}
                      {a.status === 'rejected' && (
                        <span style={{ fontSize: 11, color: '#e57373', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <ThumbsDown size={12} /> Rejected
                        </span>
                      )}
                    </div>
                  ))}
                  {approvals.length === 0 && (
                    <div className="serif italic" style={{ color: 'var(--g-700)', padding: '8px 0' }}>
                      No approval requests yet.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {!isReady && (
          <div className="modal-foot">
            <div className="left">
              {isPlanning && (
                <span className="arm-live">
                  <span className="arm-live-dot" />
                  Live
                </span>
              )}
            </div>
            <div className="right">
              <button className="btn btn-primary" onClick={ui.closePlan}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
