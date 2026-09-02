export interface TaskContext {
  title: string
  notes: string | null
  projectName: string
  repoUrl: string
  repoUrls?: string[]
  priority: string
  approvedPlanMd?: string | null
  attachments: {
    id: string
    name: string
    mimeType: string
    path: string
    url: string
  }[]
  messages?: {
    authorType: string
    kind: string
    body: string
    createdAt: number
  }[]
}

export interface BuildPromptOptions {
  runId: string
}

function getRepoUrls(task: TaskContext): string[] {
  return [...new Set([task.repoUrl, ...(task.repoUrls ?? [])].filter(Boolean))]
}

function buildRepositoryContext(task: TaskContext): string {
  const repoUrls = getRepoUrls(task)

  return `Writable repositories:
${repoUrls.map((url, index) => `- Repository ${index + 1}: ${url}`).join('\n')}`
}

function buildCloneInstructions(task: TaskContext): string {
  const repoUrls = getRepoUrls(task)
  const contextCloneCommands = repoUrls
    .slice(1)
    .map(
      (url, index) =>
        `   - Clone ${url} into \`context-repos/repo-${index + 2}\`.`,
    )
    .join('\n')

  return `2. Clone repository 1, ${repoUrls[0]}, into a subdirectory named \`repo\` in the current workspace (e.g. \`git clone ${repoUrls[0]} repo\`).
${contextCloneCommands || '   - There are no additional context repositories.'}
   - If any required clone fails because the repository does not exist or you do not have access, STOP immediately and report the exact error. Do not create a replacement local repository.
3. Inspect all cloned repositories, their conventions, and any AGENTS.md or CONTRIBUTING.md files. Every listed repository is writable. Change any repository needed to complete the task, including several repositories when the work crosses frontend and backend. Do not make unrelated changes.`
}

export function buildPrompt(
  task: TaskContext,
  options: BuildPromptOptions = { runId: 'unknown-run' },
): string {
  const branchName = `agent/${slug(task.title)}-${Date.now()}`
  const proofRoot = `.planner/proof/${options.runId}`

  const attachmentLines =
    task.attachments && task.attachments.length > 0
      ? task.attachments
          .map((a) => `- ${a.name} (${a.mimeType}) — ${a.url}`)
          .join('\n')
      : 'None'

  return `You are an expert software engineer. Your job is to implement a task from a project planner and open a Pull Request for human review.

## Task

Project: ${task.projectName}
Priority: ${task.priority}
Title: ${task.title}
${task.notes ? `Notes: ${task.notes}` : ''}
${task.messages && task.messages.length > 0 ? `\n## Conversation context\n${task.messages.map((message) => `- ${message.authorType} (${message.kind}): ${message.body}`).join('\n')}` : ''}
${buildRepositoryContext(task)}

## Attachments

The task has the following files attached for context. You can download them using curl/wget if you need to inspect them.

${attachmentLines}

## Instructions

1. Configure git for this session:
   - git config --global user.name "Planner Agent"
   - git config --global user.email "agent@planner.local"
   - If the environment variable GITHUB_TOKEN is set, configure git to use it for HTTPS pushes by running: git config --global url."https://x-access-token:\${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
${buildCloneInstructions(task)}
4. In every repository that needs changes, create a new branch named \`${branchName}\` from that repository's default branch. Immediately record it inside that repository by running \`echo "${branchName}" > .git/planner-agent-branch\`. Do not create a branch in a repository that needs no changes.
5. Inspect the repository's test commands and define a minimum sufficient matrix before you change code. Prefer one focused regression command that covers the main behavior and an edge case, plus at most one cheap repository-native gate that gives different evidence. Use only relevant layers: lint, types, targeted tests, full tests, build, API, CLI, data, and browser.
6. Implement the task. Make focused, minimal changes. Add a focused regression test when the repository has a suitable test framework. Do not refactor unrelated code.
7. Use at most 8 minutes for inspection and implementation. Reserve the remaining time for testing, evidence, commit, push, and the ready pull request. Stop adding features when the verification window begins.
8. Commit the code that you will test. Record its full Git SHA. Run the minimum sufficient matrix against that commit. Run one verification command at a time so one slow process cannot hide the result of another process. Do not use \`/usr/bin/time\`; use shell timestamps when you need a duration. Do not repeat equivalent checks, and do not run a full suite after a focused suite unless the changed surface or repository guidance makes the full suite necessary. Skip unrelated lint, type, build, API, CLI, data, and browser checks. Record each skipped layer as NOT RUN with a short reason. Record every result honestly as PASS, FAIL, BLOCKED, or NOT RUN.
9. In each changed repository, write a valid partial manifest, report, and available command logs before browser work. Record the browser check as NOT RUN while it is pending. Commit and push this proof checkpoint. Then run browser proof and update the proof pack. If browser capture is blocked, keep the browser check BLOCKED, keep the proof result partial, and do not invent missing media. Follow good commit guidelines and push each later proof update to the same branch.
10. Create one ready Pull Request in each changed repository against that repository's default branch, even when a check fails or could not run. Do NOT create draft PRs. Do NOT merge them. Show failed and incomplete checks prominently.
   - Authenticate the GitHub CLI first if needed: \`echo "\${GITHUB_TOKEN}" | gh auth login --with-token\`
   - Create each PR from inside its repository directory, e.g. \`gh pr create --title "..." --body-file pr-body.md\`.
   - Immediately capture the PR URL by running: \`gh pr view --json url -q .url\` and save it to a shell variable or capture the printed URL.
11. After each PR is created, capture its PR URL and branch name by running this exact command from inside that repository:
   \`gh pr view --json url -q .url > .git/planner-agent-pr-url && echo "${branchName}" > .git/planner-agent-branch\`
   The runner reads these private Git marker files from every repository. Do not skip this step for any changed repository.

## Required proof pack

Write all proof files under \`${proofRoot}/\` in each changed repository and commit them in that repository's Pull Request. Each bundle must be at most 20 MB. No file may be larger than 10 MB. Never include tokens, cookies, authorization headers, passwords, environment files, or private user data. Use test data. Redact sensitive URL query values.

Required files:

- \`${proofRoot}/manifest.json\`
- \`${proofRoot}/report.md\`
- Command output under \`${proofRoot}/logs/\`
- For a passing UI or mixed browser check: \`${proofRoot}/screenshots/desktop.png\`, \`${proofRoot}/screenshots/mobile.png\`, and one short \`${proofRoot}/video/ui-flow.webm\`

The manifest must use this JSON shape:

\`\`\`json
{
  "version": 1,
  "runId": "${options.runId}",
  "testedCommitSha": "40-character SHA of the code commit that you tested",
  "generatedAt": "ISO-8601 timestamp",
  "environment": { "os": "...", "runtime": "...", "browser": "optional" },
  "changeType": "ui | api | cli | library | data | docs | mixed",
  "overall": "pass | fail | partial",
  "checks": [{
    "id": "stable-id",
    "title": "User-visible check name",
    "layer": "lint | types | targeted | full | build | browser | api | cli | data",
    "status": "pass | fail | blocked | not_run",
    "command": "optional exact command",
    "exitCode": 0,
    "durationMs": 1234,
    "outputPath": "optional path relative to the proof directory",
    "evidencePaths": ["paths relative to the proof directory"]
  }],
  "artifacts": [{
    "path": "path relative to the proof directory",
    "type": "report | log | screenshot | video",
    "bytes": 123,
    "sha256": "64-character SHA-256"
  }],
  "limitations": ["honest limits and gaps"],
  "reproduce": ["exact commands or steps"]
}

Set \`overall\` to \`fail\` if any check fails. Otherwise, set it to \`partial\` if any check is blocked or not run. Set it to \`pass\` only when all recorded checks pass. The runner validates paths, links, hashes, sizes, the tested commit, and the UI media requirements.

For a BLOCKED or NOT RUN check, omit \`command\`, \`exitCode\`, and \`durationMs\` when no command ran. Do not invent a zero duration or exit code. A completed PASS or FAIL check must include its real \`durationMs\`.

For a UI change, start the current branch locally and test the primary flow in Chromium. Do not use a deployed production application as proof of an unmerged branch. If the repository provides a dedicated UI proof command such as \`pnpm proof:ui\`, use it and follow its local proof documentation. Capture the final desktop state, the final mobile state, browser console health, and a short WebM of the main flow. If browser startup, navigation, screenshots, or recording is blocked, record that browser check as BLOCKED, set the result to partial, and omit only the unavailable media. For non-UI changes, do not create fake visual proof. Use command logs, request and response transcripts, or CLI output.

## Required Pull Request body format

The PR description must include the following sections:

### Problem
Briefly describe the problem or requirement.

### Approach
Explain the approach you took to solve it.

### Is this the best way?
Discuss whether this is the best approach and mention any trade-offs.

### Alternatives considered
List at least one alternative approach and why you did not choose it.

### Best tool for the job
State which tool, library, or pattern you chose and why it is appropriate.

### Testing
Summarize the proof matrix. List PASS, FAIL, BLOCKED, and NOT RUN items. Link to \`${proofRoot}/report.md\`. Do not claim that the work is 100% verified or free of defects.

## Constraints

- You have a maximum of 15 minutes.
- Do not push directly to the default branch.
- Do not merge the Pull Request.
- If you cannot complete the task in time, commit and push what you have in every changed repository, write honest partial proof packs, and open ready Pull Requests with notes that explain what remains.
- Prefer existing project conventions and dependencies.
- If the repository has an AGENTS.md file, follow its instructions.
${
  task.approvedPlanMd
    ? `
## Approved plan

The human reviewer approved the following implementation plan. Follow it closely — deviate only where the plan is factually wrong about the codebase, and explain any deviation in the PR body.

${task.approvedPlanMd}`
    : ''
}

Begin by cloning every repository, then explore their codebases and decide which repositories the task requires you to change.`
}

export function buildAnswerPrompt(task: TaskContext): string {
  const conversation =
    task.messages
      ?.map((message) => `${message.authorType}: ${message.body}`)
      .join('\n') ?? ''
  return `You are the Planner agent. Answer the user's question using only the task context below.

Task: ${task.title}
Project: ${task.projectName}
${task.notes ? `Notes: ${task.notes}` : ''}

Conversation:
${conversation}

Rules:
- Do not edit files, create branches, run git commands, or open pull requests.
- Be concise and state when the task context does not contain enough information.
- Return only the answer for the shared task chat.`
}

const PLAN_FORMAT = `## Required plan format (markdown)

# Plan: <task title>

## Problem
What the task requires and why.

## Relevant code
The files, functions, and patterns you discovered in the repo that this change touches (with paths).

## Proposed changes
Numbered, concrete steps: which files you will change and how. Include key code shapes/signatures where useful.

## Alternatives considered
At least one alternative approach and why you did not choose it.

## Risks & edge cases
What could go wrong, and how the plan accounts for it.

## Testing
How to verify the change works (existing tests, dev server, manual steps).`

function buildPlanPreamble(task: TaskContext): string {
  return `Project: ${task.projectName}
Priority: ${task.priority}
Title: ${task.title}
${task.notes ? `Notes: ${task.notes}` : ''}
${task.messages && task.messages.length > 0 ? `\nConversation context:\n${task.messages.map((message) => `- ${message.authorType} (${message.kind}): ${message.body}`).join('\n')}` : ''}
${buildRepositoryContext(task)}`
}

const PLAN_CONSTRAINTS = `## Constraints

- You have a maximum of 15 minutes.
- READ-ONLY run: do NOT create branches, commits, pushes, or pull requests. Do NOT modify any files inside the repository.
- Your ONLY write is the plan file itself: \`.agent-plan-md\` in the workspace root (next to the \`repo\` directory, NOT inside it).
- If the clone fails because the repository does not exist or you do not have access, STOP immediately and report the exact error.
- If the repository has an AGENTS.md file, follow its conventions in your plan.`

export function buildPlanPrompt(task: TaskContext): string {
  const repoUrls = getRepoUrls(task)
  const contextCloneCommands = repoUrls
    .slice(1)
    .map(
      (url, index) =>
        `   - Clone ${url} into \`context-repos/repo-${index + 2}\`.`,
    )
    .join('\n')

  return `You are an expert software engineer. Your job is to produce a detailed implementation PLAN for a task from a project planner. A human will review your plan and approve it or request changes before any code is written.

## Task

${buildPlanPreamble(task)}

## Instructions

1. If the environment variable GITHUB_TOKEN is set, configure git to use it for HTTPS cloning by running: git config --global url."https://x-access-token:\${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
2. Clone the primary repository ${repoUrls[0]} into a subdirectory named \`repo\` (e.g. \`git clone ${repoUrls[0]} repo\`).
${contextCloneCommands || '   - There are no additional context repositories.'}
3. Explore every cloned repository: structure, conventions, relevant modules, existing tests. Read any AGENTS.md or CONTRIBUTING.md files. Treat every repository as read-only in plan mode.
4. Write your plan as markdown to \`.agent-plan-md\` in the workspace root, for example with a heredoc: \`cat > .agent-plan-md << 'PLAN_EOF' ... PLAN_EOF\`. Do not skip this step — the file is how your plan reaches the human reviewer.

${PLAN_FORMAT}

${PLAN_CONSTRAINTS}

Begin by cloning the primary repository and every context repository, then explore their codebases.`
}

export function buildPlanRevisionPrompt(
  task: TaskContext,
  previousPlan: string,
  feedback: string,
): string {
  const repoUrls = getRepoUrls(task)
  const contextCloneCommands = repoUrls
    .slice(1)
    .map(
      (url, index) =>
        `   - Clone ${url} into \`context-repos/repo-${index + 2}\` or reuse the existing clone.`,
    )
    .join('\n')

  return `You are an expert software engineer. You previously wrote an implementation plan for a task from a project planner. The human reviewer requested changes. Revise the plan to address their feedback.

## Task

${buildPlanPreamble(task)}

## Your previous plan

${previousPlan}

## Reviewer feedback

${feedback}

## Instructions

1. If the environment variable GITHUB_TOKEN is set, configure git to use it for HTTPS cloning: git config --global url."https://x-access-token:\${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
2. Clone the primary repository ${repoUrls[0]} into a subdirectory named \`repo\`, or reuse the existing clone.
${contextCloneCommands || '   - There are no additional context repositories.'}
3. Re-examine all cloned repositories as needed to address the feedback. Treat every repository as read-only in plan mode.
4. Write the REVISED plan as markdown to \`.agent-plan-md\` in the workspace root, overwriting the previous version.
5. Address every point of the reviewer feedback. Where you disagree with a suggestion, explain why in the plan.

${PLAN_FORMAT}

${PLAN_CONSTRAINTS}`
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}
