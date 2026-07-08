export interface OpenHandsConfig {
  baseUrl: string
  llmModel: string
  llmApiKey: string
  llmApiBase?: string
  timeoutMs: number
}

export interface ConversationInfo {
  id: string
  execution_status?: string
}

export interface Event {
  id: string
  source: string
  kind: string
  timestamp: string
  message?: string
  content?: string
  code?: string
  detail?: string
  extras?: Record<string, unknown>
  // ActionEvent fields
  action?: {
    command?: string
    path?: string
    summary?: string
    kind?: string
  }
  summary?: string
  // ObservationEvent fields
  observation?: {
    command?: string
    content?: Array<{ type?: string; text?: string }> | string
    exit_code?: number
    metadata?: { exit_code?: number }
    extra_content?: string
  }
  // MessageEvent fields
  llm_message?: {
    role?: string
    content?: Array<{ type?: string; text?: string }> | string
  }
}

export class OpenHandsClient {
  constructor(private config: OpenHandsConfig) {}

  async checkAlive(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/alive`)
      return res.ok
    } catch {
      return false
    }
  }

  async startConversation(prompt: string, workspaceDir: string): Promise<ConversationInfo> {
    const body = {
      agent: {
        kind: 'Agent',
        llm: {
          model: this.config.llmModel,
          api_key: this.config.llmApiKey,
          base_url: this.config.llmApiBase,
          temperature: 0,
          native_tool_calling: false,
          drop_params: true,
        },
        tools: [
          { name: 'terminal' },
          { name: 'file_editor' },
          { name: 'task_tracker' },
          { name: 'browser_tool_set' },
        ],
      },
      workspace: {
        kind: 'LocalWorkspace',
        working_dir: workspaceDir,
      },
      initial_message: {
        content: [{ text: prompt }],
      },
    }

    const res = await fetch(`${this.config.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`OpenHands start conversation failed: ${res.status} ${text}`)
    }

    return (await res.json()) as ConversationInfo
  }

  async runConversation(conversationId: string): Promise<void> {
    const res = await fetch(
      `${this.config.baseUrl}/api/conversations/${conversationId}/run`,
      { method: 'POST' },
    )
    // 409 means the conversation is already running, which is fine.
    if (res.status === 409) {
      return
    }
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`OpenHands run conversation failed: ${res.status} ${text}`)
    }
  }

  async getConversation(conversationId: string): Promise<{ execution_status: string }> {
    const res = await fetch(
      `${this.config.baseUrl}/api/conversations/${conversationId}`,
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`OpenHands get conversation failed: ${res.status} ${text}`)
    }
    return (await res.json()) as { execution_status: string }
  }

  async pollEvents(
    conversationId: string,
    opts: {
      onEvent: (event: Event) => void
      shouldStop: () => boolean
      onPoll?: (newEventCount: number) => void
      intervalMs?: number
    },
  ): Promise<void> {
    const { onEvent, shouldStop, onPoll, intervalMs = 2000 } = opts
    const seenIds = new Set<string>()

    while (!shouldStop()) {
      const res = await fetch(
        `${this.config.baseUrl}/api/conversations/${conversationId}/events/search?limit=100`,
      )
      if (!res.ok) {
        await sleep(intervalMs)
        continue
      }

      const page = (await res.json()) as { items: Event[]; next_page_id?: string | null }
      const newEvents = (page.items ?? []).filter((e) => !seenIds.has(e.id))
      for (const event of newEvents) {
        seenIds.add(event.id)
        onEvent(event)
      }
      onPoll?.(newEvents.length)

      await sleep(intervalMs)
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
