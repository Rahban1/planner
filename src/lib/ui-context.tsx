import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'

export interface TaskModalState {
  taskId: string | null
  projectIdForNew: string | null
  projectName?: string | null
  projectRepoUrl?: string | null
}

export interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void
}

interface UIContextValue {
  taskModal: TaskModalState | null
  openTask: (taskId: string, projectName?: string | null, projectRepoUrl?: string | null) => void
  openNewTask: (projectId: string, projectName?: string | null, projectRepoUrl?: string | null) => void
  closeTask: () => void
  agentRunModal: { taskId: string } | null
  openAgentRun: (taskId: string) => void
  closeAgentRun: () => void
  planModal: { taskId: string } | null
  openPlan: (taskId: string) => void
  closePlan: () => void
  cmdkOpen: boolean
  openCmdk: () => void
  closeCmdk: () => void
  projectModalOpen: boolean
  openProjectModal: () => void
  closeProjectModal: () => void
  shortcutsOpen: boolean
  openShortcuts: () => void
  closeShortcuts: () => void
  confirmState: ConfirmState | null
  requestConfirm: (options: ConfirmOptions) => Promise<boolean>
  resolveConfirm: (value: boolean) => void
}

const Ctx = createContext<UIContextValue | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [taskModal, setTaskModal] = useState<TaskModalState | null>(null)
  const [agentRunModal, setAgentRunModal] = useState<{ taskId: string } | null>(null)
  const [planModal, setPlanModal] = useState<{ taskId: string } | null>(null)
  const [cmdkOpen, setCmdkOpen] = useState(false)
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  const requestConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({ ...options, resolve })
    })
  }, [])

  const resolveConfirm = useCallback((value: boolean) => {
    setConfirmState((current) => {
      current?.resolve(value)
      return null
    })
  }, [])

  return (
    <Ctx.Provider
      value={{
        taskModal,
        openTask: (taskId, projectName = null, projectRepoUrl = null) =>
          setTaskModal({ taskId, projectIdForNew: null, projectName, projectRepoUrl }),
        openNewTask: (projectId, projectName = null, projectRepoUrl = null) =>
          setTaskModal({ taskId: null, projectIdForNew: projectId, projectName, projectRepoUrl }),
        closeTask: () => setTaskModal(null),
        agentRunModal,
        openAgentRun: (taskId) => setAgentRunModal({ taskId }),
        closeAgentRun: () => setAgentRunModal(null),
        planModal,
        openPlan: (taskId) => setPlanModal({ taskId }),
        closePlan: () => setPlanModal(null),
        cmdkOpen,
        openCmdk: () => setCmdkOpen(true),
        closeCmdk: () => setCmdkOpen(false),
        projectModalOpen,
        openProjectModal: () => setProjectModalOpen(true),
        closeProjectModal: () => setProjectModalOpen(false),
        shortcutsOpen,
        openShortcuts: () => setShortcutsOpen(true),
        closeShortcuts: () => setShortcutsOpen(false),
        confirmState,
        requestConfirm,
        resolveConfirm,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useUI() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useUI must be used within UIProvider')
  return ctx
}