import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface TaskActions {
  open: () => void
  complete: () => void
  uncomplete?: () => void
  delete: () => void
}

interface FocusContextValue {
  focusedTaskId: string | null
  register: (taskIds: string[], handlers: Record<string, TaskActions>) => void
  focusTask: (id: string) => void
  focusIndex: (index: number) => void
  next: () => void
  prev: () => void
  first: () => void
  clearFocus: () => void
  getActions: (id: string) => TaskActions | undefined
}

const Ctx = createContext<FocusContextValue | null>(null)

export function FocusProvider({ children }: { children: ReactNode }) {
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const taskIdsRef = useRef<string[]>([])
  const handlersRef = useRef<Map<string, TaskActions>>(new Map())
  const focusedIndexRef = useRef<number | null>(null)

  const register = useCallback((taskIds: string[], handlers: Record<string, TaskActions>) => {
    taskIdsRef.current = taskIds
    handlersRef.current = new Map(Object.entries(handlers))

    // If the focused index still exists, sync the focused ID.
    const idx = focusedIndexRef.current
    if (idx !== null) {
      if (idx >= taskIds.length) {
        // Clamped — the last task was removed
        if (taskIds.length === 0) {
          focusedIndexRef.current = null
          setFocusedTaskId(null)
        } else {
          focusedIndexRef.current = taskIds.length - 1
          setFocusedTaskId(taskIds[taskIds.length - 1])
        }
      } else {
        const newId = taskIds[idx]
        setFocusedTaskId((prev) => (prev === newId ? prev : newId ?? null))
      }
    }
  }, [])

  const scrollIntoView = (id: string) => {
    requestAnimationFrame(() => {
      document
        .getElementById(`focus-${id}`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    })
  }

  const focusTask = useCallback((id: string) => {
    const ids = taskIdsRef.current
    const idx = ids.indexOf(id)
    focusedIndexRef.current = idx >= 0 ? idx : null
    setFocusedTaskId(id)
    scrollIntoView(id)
  }, [])

  const focusIndex = useCallback(
    (index: number) => {
      const ids = taskIdsRef.current
      if (ids.length === 0) return
      const clamped = Math.max(0, Math.min(index, ids.length - 1))
      focusedIndexRef.current = clamped
      const id = ids[clamped]
      setFocusedTaskId(id)
      scrollIntoView(id)
    },
    [],
  )

  const next = useCallback(() => {
    const ids = taskIdsRef.current
    if (ids.length === 0) return
    const cur = focusedIndexRef.current ?? -1
    focusIndex(Math.min(cur + 1, ids.length - 1))
  }, [focusIndex])

  const prev = useCallback(() => {
    const ids = taskIdsRef.current
    if (ids.length === 0) return
    const cur = focusedIndexRef.current ?? 0
    focusIndex(Math.max(cur - 1, 0))
  }, [focusIndex])

  const first = useCallback(() => {
    focusIndex(0)
  }, [focusIndex])

  const clearFocus = useCallback(() => {
    focusedIndexRef.current = null
    setFocusedTaskId(null)
  }, [])

  const getActions = useCallback((id: string) => {
    return handlersRef.current.get(id)
  }, [])

  // Clear focus when navigating away (route change detected via location)
  useEffect(() => {
    return () => {
      focusedIndexRef.current = null
    }
  }, [])

  return (
    <Ctx.Provider
      value={{ focusedTaskId, register, focusTask, focusIndex, next, prev, first, clearFocus, getActions }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useFocus() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useFocus must be used within FocusProvider')
  return ctx
}