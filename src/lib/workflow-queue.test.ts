// @vitest-environment node
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  approveQueuedPlanSql,
  approveRunGuardSql,
  queueRunInsertSql,
  revisePlanSql,
} from './workflow-queue'

let database: DatabaseSync
beforeEach(() => {
  database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  for (const name of [
    '0000_init.sql',
    '0001_add_agent_runs.sql',
    '0003_plan_runs.sql',
    '0009_task_chat.sql',
    '0010_github_actions_runner.sql',
    '0011_daily_workflow.sql',
  ])
    database.exec(
      readFileSync(
        new URL(`../../drizzle/migrations/${name}`, import.meta.url),
        'utf8',
      ),
    )
  database.exec(
    "INSERT INTO projects(id,name,created_at,updated_at) VALUES ('project','Project',1,1); INSERT INTO tasks(id,project_id,title,created_at,updated_at) VALUES ('task','project','Task',1,1); INSERT INTO agent_runs(id,task_id,project_id,status,kind,plan_md,plan_version,created_at,updated_at) VALUES ('plan','task','project','plan_ready','plan','A reviewed plan',2,1,1)",
  )
})
afterEach(() => database.close())

function queue(id: string, kind: string, version?: number) {
  const values = [
    id,
    'task',
    'project',
    kind,
    'https://github.com/owner/repo',
    null,
    null,
    null,
    null,
    kind === 'implement' ? 'plan' : null,
    'user',
    '[]',
    2,
    2,
    'task',
  ]
  return database
    .prepare(
      queueRunInsertSql + (version === undefined ? '' : approveRunGuardSql),
    )
    .run(...values, ...(version === undefined ? [] : ['plan', 'task', version]))
}
function approve(id: string, version: number) {
  database.exec('BEGIN')
  const result = queue(id, 'implement', version)
  database.prepare(approveQueuedPlanSql).run('user', 2, 'plan', id)
  database.exec('COMMIT')
  return result
}

describe('D1 queue and approval predicates in SQLite', () => {
  it('applies the production migration and preserves plan versions', () => {
    expect(
      database
        .prepare("PRAGMA table_info('agent_runs')")
        .all()
        .some((column) => column.name === 'source_run_id'),
    ).toBe(true)
    expect(
      database
        .prepare("PRAGMA table_info('projects')")
        .all()
        .some((column) => column.name === 'instructions'),
    ).toBe(true)
  })
  it('queues implementation and records approval together, once', () => {
    expect(approve('implementation', 2).changes).toBe(1)
    expect(
      database.prepare("SELECT status FROM agent_runs WHERE id='plan'").get()
        ?.status,
    ).toBe('approved')
    expect(approve('duplicate', 2).changes).toBe(0)
    database.exec(
      "UPDATE agent_runs SET status='success' WHERE id='implementation'",
    )
    expect(approve('late-duplicate', 2).changes).toBe(0)
  })
  it('rejects a stale plan version without recording approval or a run', () => {
    expect(approve('stale', 1).changes).toBe(0)
    expect(
      database.prepare("SELECT status FROM agent_runs WHERE id='plan'").get()
        ?.status,
    ).toBe('plan_ready')
    expect(
      database.prepare("SELECT id FROM agent_runs WHERE id='stale'").get(),
    ).toBeUndefined()
  })
  it('serializes questions, revisions, and implementation for one task', () => {
    expect(queue('answer', 'answer').changes).toBe(1)
    expect(queue('revision', 'revise').changes).toBe(0)
    expect(approve('implementation', 2).changes).toBe(0)
    expect(
      database.prepare(revisePlanSql).run('New steps', 3, 'plan', 2).changes,
    ).toBe(0)
  })
  it('lets only one of plan revision and approval win', () => {
    expect(
      database.prepare(revisePlanSql).run('New steps', 3, 'plan', 2).changes,
    ).toBe(1)
    expect(approve('implementation', 2).changes).toBe(0)
    expect(
      database
        .prepare("SELECT plan_version FROM agent_runs WHERE id='plan'")
        .get()?.plan_version,
    ).toBe(3)
  })
  it('rejects approval of a plan superseded by a newer plan', () => {
    database.exec(
      "INSERT INTO agent_runs(id,task_id,project_id,status,kind,plan_md,created_at,updated_at) VALUES ('new-plan','task','project','plan_ready','plan','New plan',5,5)",
    )
    expect(approve('old-plan-build', 2).changes).toBe(0)
  })
})
