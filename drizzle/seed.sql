-- Seed data for local dev
INSERT INTO projects (id, name, position, repo_url, created_at, updated_at, archived) VALUES
  ('p_app_a', 'App A', 0, 'https://github.com/acme/widget', 1751800000000, 1751800000000, 0),
  ('p_app_b', 'App B', 1, 'https://github.com/acme/billing', 1751800000000, 1751800000000, 0),
  ('p_app_c', 'App C', 2, 'https://github.com/acme/agent', 1751800000000, 1751800000000, 0);

INSERT INTO tasks (id, project_id, parent_id, title, notes, priority, status, due_at, position, completed_at, created_at, updated_at) VALUES
  -- App A
  ('t_auth',  'p_app_a', NULL, 'Fix auth redirect loop',       'After merging the auth refactor, deep links from /login bounce back to /login in a loop. Suspect the returnTo cookie is cleared too early in middleware.', 'urgent', 'todo',  1751880000000, 0, NULL, 1751800000000, 1751800000000),
  ('t_set',   'p_app_a', NULL, 'Build settings page',         'General settings + workspace settings. Use the new Tabs primitive. Inline edit for org name with optimistic update.', 'high',   'todo',  NULL,         1, NULL, 1751800000000, 1751800000000),
  ('t_rfum',  'p_app_a', NULL, 'Refactor user model',         NULL, 'low',    'done',  NULL,         0, 1751820000000, 1751790000000, 1751790000000),
  ('t_seed',  'p_app_a', NULL, 'Seed script for staging',     NULL, 'low',    'done',  NULL,         1, 1751825000000, 1751790000000, 1751790000000),
  -- App B
  ('t_stripe','p_app_b', NULL, 'Implement Stripe webhook handler', 'Handle invoice.paid, invoice.payment_failed, customer.subscription_deleted. Idempotency via event id on the events table.', 'high',   'todo',  1751966400000, 0, NULL, 1751800000000, 1751800000000),
  ('t_tail',  'p_app_b', NULL, 'Migrate to Tailwind v4',      'Run codemod first, audit the renamed tokens, ship behind a feature flag on staging.', 'medium', 'todo',  1752139200000, 1, NULL, 1751800000000, 1751800000000),
  ('t_br',    'p_app_b', NULL, 'Set up billing routes',       NULL, 'low',    'done',  NULL,         0, 1751830000000, 1751790000000, 1751790000000),
  -- App C
  ('t_ctx',   'p_app_c', NULL, 'Design context-window prompt','Prompt must include repo file tree, recent commits, and the task description. Aim for ~12k tokens.', 'medium', 'todo',  NULL,         0, NULL, 1751800000000, 1751800000000),
  -- Subtasks for auth loop
  ('st_repro','p_app_a', 't_auth', 'Repro on staging with a deep link',  NULL, 'low', 'todo',  NULL,          0, NULL, 1751800000000, 1751800000000),
  ('st_test', 'p_app_a', 't_auth', 'Add middleware unit test for returnTo', NULL, 'low', 'todo',  NULL,          1, NULL, 1751800000000, 1751800000000),
  ('st_hot',  'p_app_a', 't_auth', 'Ship hotfix',                       NULL, 'low', 'done',  NULL,          2, 1751820500000, 1751800000000, 1751820000000);

-- Generated_at migration note: timestamps are synthetic unix-ms for dev only.