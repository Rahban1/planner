// Keep the locking predicates in one place so SQLite tests exercise the exact
// statements used by the Worker.
export const queueRunInsertSql = `INSERT INTO agent_runs (id,task_id,project_id,status,kind,repo_url,branch_name,pr_url,pr_number,trigger_message_id,source_run_id,approved_by_user_id,logs,created_at,updated_at)
SELECT ?,?,?,'queued',?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM agent_runs WHERE task_id = ? AND status IN ('queued','running'))`

export const approveRunGuardSql = ` AND EXISTS (SELECT 1 FROM agent_runs plan WHERE plan.id = ? AND plan.task_id = ? AND plan.kind = 'plan' AND plan.status = 'plan_ready' AND plan.plan_version = ? AND NOT EXISTS (SELECT 1 FROM agent_runs newer WHERE newer.task_id = plan.task_id AND newer.kind = 'plan' AND newer.created_at > plan.created_at))`

export const approveQueuedPlanSql =
  "UPDATE agent_runs SET status='approved', approved_by_user_id=?, updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM agent_runs WHERE id=?)"

export const revisePlanSql =
  "UPDATE agent_runs SET status='queued',plan_feedback=?,plan_version=plan_version+1,error_message=NULL,runner_job_id=NULL,runner_job_url=NULL,dispatched_at=NULL,updated_at=? WHERE id=? AND status='plan_ready' AND plan_version=? AND NOT EXISTS (SELECT 1 FROM agent_runs active WHERE active.task_id=agent_runs.task_id AND active.status IN ('queued','running')) AND NOT EXISTS (SELECT 1 FROM agent_runs newer WHERE newer.task_id=agent_runs.task_id AND newer.kind='plan' AND newer.created_at>agent_runs.created_at)"

export const triggerActionGuardSql =
  ' AND NOT EXISTS (SELECT 1 FROM agent_runs WHERE task_id = ? AND kind = ? AND trigger_message_id = ?)'
export const implementationSourceGuardSql =
  " AND NOT EXISTS (SELECT 1 FROM agent_runs WHERE task_id = ? AND kind = 'implement' AND source_run_id = ?)"
