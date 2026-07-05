import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'

export interface TaskModalState {
  taskId: string | null
  projectIdForNew: string | null
  projectName?: string | null
  projectRepoUrl?: string | null
}

interface UIContextValue {
  taskModal: TaskModalState | null
  openTask: (taskId: string, projectName?: string | null, projectRepoUrl?: string | null) => void
  openNewTask: (projectId: string, projectName?: string | null, projectRepoUrl?: string | null) => void
  closeTask: () => void
  cmdkOpen: boolean
  openCmdk: () => void
  closeCmdk: () => void
}

const Ctx = createContext<UIContextValue | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [taskModal, setTaskModal] = useState<TaskModalState | null>(null)
  const [cmdkOpen, setCmdkOpen] = useState(false)

  return (
    <Ctx.Provider
      value={{
        taskModal,
        openTask: (taskId, projectName = null, projectRepoUrl = null) =>
          setTaskModal({ taskId, projectIdForNew: null, projectName, projectRepoUrl }),
        openNewTask: (projectId, projectName = null, projectRepoUrl = null) =>
          setTaskModal({ taskId: null, projectIdForNew: projectId, projectName, projectRepoUrl }),
        closeTask: () => setTaskModal(null),
        cmdkOpen,
        openCmdk: () => setCmdkOpen(true),
        closeCmdk: () => setCmdkOpen(false),
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