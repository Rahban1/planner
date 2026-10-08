import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  ModelRuntime,
  createCodingTools,
  createReadOnlyTools,
  getAgentDir,
  readStoredCredential,
} from '@earendil-works/pi-coding-agent'
import {
  Harness,
  createRegistry,
  defineExtension,
  defineTool,
} from '@earendil-works/pi-durable'
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import lockfile from 'proper-lockfile'
import type { Models } from '@earendil-works/pi-ai'
import type {
  Conversation,
  Cursor,
  EntryRecord,
  ModelRef,
  Submission,
  ToolRegistration,
} from '@earendil-works/pi-durable'
import type { AgentBackend, ConversationOptions } from './agent-backend.js'
import type { ConversationInfo, Event } from './openhands.js'

const context = BACKGROUND_CONTEXT
export const PI_PROVIDER = 'openai-codex'
export const PI_DEFAULT_MODEL = 'gpt-6.1-sol'

export interface PiConfig {
  stateDir: string
  authDir?: string
  modelId?: string
  /** Local proof injects Pi's model simulator. Production uses ChatGPT OAuth. */
  models?: Models
  model?: ModelRef
  extraTools?: ToolRegistration[]
}

interface RunRecord {
  runId: string
  workspaceDir: string
  readOnly: boolean
  model: ModelRef
  submissionId?: number
  requestId?: string
}

interface Session {
  harness: Harness
  conversation: Conversation
  submission: Submission
}

export function piAuthStatus(authDir = getAgentDir()) {
  const credential = readStoredCredential(
    PI_PROVIDER,
    join(authDir, 'auth.json'),
  )
  return {
    provider: PI_PROVIDER,
    configured: credential?.type === 'oauth',
    authDir,
  }
}

/** Pi coding-agent tools, Pi Durable execution, and ChatGPT subscription auth. */
export class PiClient implements AgentBackend {
  private readonly sessions = new Map<string, Session>()
  private closed = false
  private constructor(
    private readonly config: PiConfig,
    private readonly models: Models,
    private readonly releaseLock: () => Promise<void>,
  ) {}

  static async create(config: PiConfig): Promise<PiClient> {
    await mkdir(config.stateDir, { recursive: true })
    const release = await lockfile.lock(config.stateDir, {
      realpath: true,
      stale: 10_000,
      update: 2500,
      retries: { retries: 12, minTimeout: 1000, maxTimeout: 1000 },
    })
    try {
      const authDir = config.authDir ?? getAgentDir()
      if (!config.models && !piAuthStatus(authDir).configured) {
        throw new Error(
          'Pi needs your ChatGPT login. Run npm run pi:login in agent-runner.',
        )
      }
      const models =
        config.models ??
        (await ModelRuntime.create({
          authPath: join(authDir, 'auth.json'),
          modelsPath: null,
          refreshOnCreate: false,
        }))
      return new PiClient(config, models, release)
    } catch (error) {
      await release()
      throw error
    }
  }

  async checkAlive(): Promise<boolean> {
    return true
  }

  async listRunIds(): Promise<string[]> {
    const names = await readdir(this.config.stateDir, { withFileTypes: true })
    return names.filter((item) => item.isDirectory()).map((item) => item.name)
  }

  async startConversation(
    prompt: string,
    workspaceDir: string,
    options: ConversationOptions = {},
  ): Promise<ConversationInfo> {
    const runId = options.runId ?? basename(workspaceDir)
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Invalid Pi run ID.')
    if (this.sessions.has(runId)) return { id: runId }
    const runDir = join(this.config.stateDir, runId)
    await mkdir(runDir, { recursive: true })
    let record: RunRecord
    try {
      record = JSON.parse(
        await readFile(join(runDir, 'run.json'), 'utf8'),
      ) as RunRecord
      if (resolve(record.workspaceDir) !== resolve(workspaceDir)) {
        throw new Error(
          'The Pi workspace path changed. Restore the original workspace.',
        )
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      record = {
        runId,
        workspaceDir: resolve(workspaceDir),
        readOnly: options.readOnly ?? false,
        model: this.config.model ?? {
          provider: PI_PROVIDER,
          modelId: this.config.modelId ?? PI_DEFAULT_MODEL,
        },
      }
      await this.saveRecord(runDir, record)
    }
    if (!this.models.getModel(record.model.provider, record.model.modelId)) {
      throw new Error(
        `Pi model is unavailable: ${record.model.provider}/${record.model.modelId}`,
      )
    }

    const piTools = record.readOnly
      ? createReadOnlyTools(record.workspaceDir)
      : createCodingTools(record.workspaceDir)
    const tools = piTools.map((tool) =>
      defineTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        prepareArguments: tool.prepareArguments,
        // File reads are safe to repeat. Shell commands and file changes are not.
        replay: ['read', 'grep', 'find', 'ls'].includes(tool.name)
          ? 'safe'
          : 'unsafe',
        executionMode: 'sequential',
        execute: async (args, api, callContext) => {
          const result = await tool.execute(
            api.callId,
            args,
            callContext.abortSignal,
            (update) => {
              for (const part of update.content) {
                if (part.type === 'text') api.output(part.text)
              }
            },
          )
          return { content: result.content }
        },
      }),
    )
    const registry = createRegistry()
    registry.install(
      defineExtension({
        name: 'planner-pi-coding-agent',
        tools: [...tools, ...(this.config.extraTools ?? [])],
      }),
    )
    const harness = await Harness.open(
      await openNodeSqliteStorage(join(runDir, 'agent.sqlite')),
      {
        models: this.models,
        registry,
        env: ({ cwd }) =>
          new NodeExecutionEnv({ cwd: cwd ?? record.workspaceDir }),
        settings: { toolExecution: 'sequential' },
        onReport: (error) =>
          console.error('[pi] runtime report:', String(error)),
      },
      context,
    )
    try {
      const conversation = await harness.root(context, {
        agent: {
          model: record.model,
          cwd: record.workspaceDir,
          instructions:
            'You are the Pi coding agent in Planner. Follow the task prompt and repository instructions. Use the supplied Pi tools. Write user explanations in ASD-STE100.',
        },
      })
      // Admission is durable. The same request ID finds the original submission
      // even if the process died before run.json recorded its submission ID.
      const submission = await conversation.submit(
        {
          type: 'input',
          content: prompt,
          requestId: options.requestId ?? `planner:${runId}`,
        },
        context,
      )
      record.submissionId = submission.id
      record.requestId = options.requestId ?? `planner:${runId}`
      await this.saveRecord(runDir, record)
      this.sessions.set(runId, { harness, conversation, submission })
      return { id: runId }
    } catch (error) {
      await harness.close(context)
      throw error
    }
  }

  async runConversation(id: string): Promise<void> {
    this.session(id).harness.resume()
  }

  async pauseConversation(id: string): Promise<void> {
    await this.session(id).conversation.abort(context)
  }

  async getConversation(id: string): Promise<{ execution_status: string }> {
    const record = await this.session(id).submission.status(context)
    return {
      execution_status:
        record.status === 'done'
          ? 'finished'
          : record.status === 'unanswered'
            ? 'error'
            : 'running',
    }
  }

  async entries(id: string): Promise<EntryRecord[]> {
    const entries: EntryRecord[] = []
    let cursor: Cursor | undefined
    do {
      const page = await this.session(id).conversation.entries(
        {},
        200,
        cursor,
        context,
      )
      entries.push(...page.items)
      cursor = page.next
    } while (cursor)
    return entries.reverse()
  }

  async pollEvents(
    id: string,
    options: Parameters<AgentBackend['pollEvents']>[1],
  ): Promise<void> {
    const seen = new Set<string>()
    while (!(await options.shouldStop())) {
      const events = (await this.entries(id)).flatMap(entryEvents)
      let count = 0
      for (const event of events) {
        if (seen.has(event.id)) continue
        seen.add(event.id)
        options.onEvent(event)
        count += 1
      }
      // Surface a provider or runtime failure even when no assistant text exists.
      const submission = await this.session(id).submission.status(context)
      if (submission.status === 'unanswered' && !seen.has('pi-error')) {
        seen.add('pi-error')
        options.onEvent({
          id: 'pi-error',
          source: 'agent',
          kind: 'ConversationErrorEvent',
          timestamp: new Date().toISOString(),
          message: `Pi could not complete this run: ${submission.reason}`,
        })
        count += 1
      }
      await options.onPoll?.(count)
      await new Promise((done) => setTimeout(done, options.intervalMs ?? 2000))
    }
  }

  async wait(id: string) {
    return this.session(id).submission.wait(context)
  }

  async release(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    await session.harness.close(context)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const id of this.sessions.keys()) await this.release(id)
    await this.releaseLock()
  }

  private session(id: string): Session {
    const session = this.sessions.get(id)
    if (!session) throw new Error(`Pi run is not open: ${id}`)
    return session
  }

  private async saveRecord(runDir: string, record: RunRecord): Promise<void> {
    const temporary = join(runDir, 'run.json.tmp')
    await writeFile(temporary, JSON.stringify(record, null, 2), { mode: 0o600 })
    await rename(temporary, join(runDir, 'run.json'))
  }
}

export function entryEvents(entry: EntryRecord): Event[] {
  return (entry.model ?? []).flatMap((message, messageIndex) => {
    const base = {
      id: `${entry.id}:${messageIndex}`,
      source: 'agent',
      timestamp: new Date(message.timestamp ?? 0).toISOString(),
    }
    if (message.role === 'assistant') {
      const events: Event[] = []
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      if (text)
        events.push({
          ...base,
          kind: 'MessageEvent',
          message: text,
          llm_message: { role: 'assistant', content: text },
        })
      message.content.forEach((part, index) => {
        if (part.type === 'toolCall')
          events.push({
            ...base,
            id: `${base.id}:tool:${index}`,
            kind: 'ActionEvent',
            summary: `Pi ${part.name}`,
            action: {
              command:
                typeof part.arguments.command === 'string'
                  ? part.arguments.command
                  : undefined,
              path:
                typeof part.arguments.path === 'string'
                  ? part.arguments.path
                  : undefined,
            },
          })
      })
      return events
    }
    if (message.role === 'toolResult')
      return [
        {
          ...base,
          kind: 'ObservationEvent',
          observation: {
            command: message.toolName,
            content: message.content.filter((part) => part.type === 'text'),
          },
        },
      ]
    return []
  })
}
