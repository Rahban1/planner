import type { ConversationInfo, Event } from './openhands.js'

export interface ConversationOptions {
  readOnly?: boolean
  runId?: string
  requestId?: string
}

/** The runner contract shared by the OpenHands and Pi backends. */
export interface AgentBackend {
  checkAlive: () => Promise<boolean>
  startConversation: (
    prompt: string,
    workspaceDir: string,
    options?: ConversationOptions,
  ) => Promise<ConversationInfo>
  runConversation: (conversationId: string) => Promise<void>
  pauseConversation: (conversationId: string) => Promise<void>
  getConversation: (conversationId: string) => Promise<{ execution_status: string }>
  pollEvents: (
    conversationId: string,
    options: {
      onEvent: (event: Event) => void
      shouldStop: () => boolean | Promise<boolean>
      onPoll?: (newEventCount: number) => void | Promise<void>
      intervalMs?: number
    },
  ) => Promise<void>
}
