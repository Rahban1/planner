# GitHub Actions runner

Planner can start one temporary Linux runner for each agent run. This removes the need for an always-on Mac or paid virtual machine.

## Required configuration

Create a GitHub environment named `planner-runner` in `Rahban1/planner`. Do not add a required reviewer because scheduled pull-request checks cannot wait for approval.

Add these environment secrets:

- `RUNNER_API_TOKEN`: Use the same value as the Cloudflare Worker secret.
- `LLM_API_KEY`: Use the OpenCode Go API key.
- `AGENT_GITHUB_TOKEN`: Use a fine-grained token that can write repository contents and pull requests in each target repository.

Add these environment variables:

- `PLANNER_BASE_URL`: Set it to `https://planner.rahban-ghani2001.workers.dev`.
- `LLM_MODEL`: Optional. The default is `openai/kimi-k2.6`.
- `LLM_API_BASE`: Optional. The default is `https://opencode.ai/zen/go/v1`.

Create a separate fine-grained token for the Worker. Give it only Actions write access to `Rahban1/planner`. Store it as a Worker secret:

```bash
pnpm wrangler secret put GITHUB_ACTIONS_DISPATCH_TOKEN
```

The Worker uses the non-secret repository and workflow names in `wrangler.jsonc`.

## Activation

Apply migration `0010_github_actions_runner.sql`, deploy the Worker, and push the two workflow files to the configured `master` ref. A run cannot start from GitHub Actions until all three changes are present.

## Expected behavior

When the dispatch token is present, Planner starts `planner-agent-run.yml` immediately. The workflow claims one exact run ID. A duplicate workflow cannot run the same task. The workflow reports setup failures, cancellations, and incomplete success states to Planner.

When the dispatch token is absent, Planner keeps the local Docker polling behavior. This fallback supports local development.

`planner-merge-watch.yml` checks open pull requests every five minutes and updates merged or closed runs. It also marks GitHub-backed runs as failed when they remain queued or running for more than 40 minutes. It does not start OpenHands.
