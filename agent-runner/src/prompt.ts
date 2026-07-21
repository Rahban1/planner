export interface TaskContext {
  title: string
  notes: string | null
  projectName: string
  repoUrl: string
  priority: string
  approvedPlanMd?: string | null
  attachments: { id: string; name: string; mimeType: string; path: string; url: string }[]
}

export function buildPrompt(task: TaskContext): string {
  const branchName = `agent/${slug(task.title)}-${Date.now()}`

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
Repository: ${task.repoUrl}

## Attachments

The task has the following files attached for context. You can download them using curl/wget if you need to inspect them.

${attachmentLines}

## Instructions

1. Configure git for this session:
   - git config --global user.name "Planner Agent"
   - git config --global user.email "agent@planner.local"
   - If the environment variable GITHUB_TOKEN is set, configure git to use it for HTTPS pushes by running: git config --global url."https://x-access-token:\${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
2. Clone the repository ${task.repoUrl} into a subdirectory named \`repo\` in the current workspace (e.g. \`git clone ${task.repoUrl} repo\`).
   - If the clone fails because the repository does not exist or you do not have access, STOP immediately and report the exact error. Do not try to create a local git repository or use the workspace root as the repository.
3. Work inside the \`repo\` directory. Inspect the codebase, conventions, and any AGENTS.md or CONTRIBUTING.md files.
4. Create a new branch named \`${branchName}\` from the repository's default branch.
5. Implement the task. Make focused, minimal changes. Do not refactor unrelated code.
6. Follow good commit guidelines: use a clear commit message in the imperative mood, e.g. "feat: refactor user model".
7. Push the branch to the remote origin.
8. Create a Pull Request against the repository's default branch. Do NOT merge it.
   - Authenticate the GitHub CLI first if needed: \`echo "\${GITHUB_TOKEN}" | gh auth login --with-token\`
   - Create the PR from inside the \`repo\` directory, e.g. \`gh pr create --title "..." --body-file pr-body.md\`
   - Immediately capture the PR URL by running: \`gh pr view --json url -q .url\` and save it to a shell variable or capture the printed URL.
9. After the PR is created, capture the PR URL and branch name by running this exact command from inside the \`repo\` directory:
   \`gh pr view --json url -q .url > ../.agent-pr-url && echo "${branchName}" > ../.agent-branch-name\`
   This writes the marker files to the workspace root. Do not skip this step.

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
Describe how you verified the change works. If the project has tests or a dev server, run them.

## Constraints

- You have a maximum of 15 minutes.
- Do not push directly to the default branch.
- Do not merge the Pull Request.
- If you cannot complete the task in time, commit what you have and open a draft PR with a note explaining what remains.
- Prefer existing project conventions and dependencies.
- If the repository has an AGENTS.md file, follow its instructions.
${task.approvedPlanMd ? `
## Approved plan

The human reviewer approved the following implementation plan. Follow it closely — deviate only where the plan is factually wrong about the codebase, and explain any deviation in the PR body.

${task.approvedPlanMd}` : ''}

Begin by cloning ${task.repoUrl} and exploring the codebase.`
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
Repository: ${task.repoUrl}`
}

const PLAN_CONSTRAINTS = `## Constraints

- You have a maximum of 15 minutes.
- READ-ONLY run: do NOT create branches, commits, pushes, or pull requests. Do NOT modify any files inside the repository.
- Your ONLY write is the plan file itself: \`.agent-plan-md\` in the workspace root (next to the \`repo\` directory, NOT inside it).
- If the clone fails because the repository does not exist or you do not have access, STOP immediately and report the exact error.
- If the repository has an AGENTS.md file, follow its conventions in your plan.`

export function buildPlanPrompt(task: TaskContext): string {
  return `You are an expert software engineer. Your job is to produce a detailed implementation PLAN for a task from a project planner. A human will review your plan and approve it or request changes before any code is written.

## Task

${buildPlanPreamble(task)}

## Instructions

1. If the environment variable GITHUB_TOKEN is set, configure git to use it for HTTPS cloning by running: git config --global url."https://x-access-token:\${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
2. Clone the repository ${task.repoUrl} into a subdirectory named \`repo\` (e.g. \`git clone ${task.repoUrl} repo\`).
3. Explore the codebase: structure, conventions, relevant modules, existing tests. Read any AGENTS.md or CONTRIBUTING.md files.
4. Write your plan as markdown to \`.agent-plan-md\` in the workspace root, for example with a heredoc: \`cat > .agent-plan-md << 'PLAN_EOF' ... PLAN_EOF\`. Do not skip this step — the file is how your plan reaches the human reviewer.

${PLAN_FORMAT}

${PLAN_CONSTRAINTS}

Begin by cloning ${task.repoUrl} and exploring the codebase.`
}

export function buildPlanRevisionPrompt(
  task: TaskContext,
  previousPlan: string,
  feedback: string,
): string {
  return `You are an expert software engineer. You previously wrote an implementation plan for a task from a project planner. The human reviewer requested changes. Revise the plan to address their feedback.

## Task

${buildPlanPreamble(task)}

## Your previous plan

${previousPlan}

## Reviewer feedback

${feedback}

## Instructions

1. If the environment variable GITHUB_TOKEN is set, configure git to use it for HTTPS cloning: git config --global url."https://x-access-token:\${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
2. Clone ${task.repoUrl} into a subdirectory named \`repo\` (or reuse it if it already exists from your previous session).
3. Re-examine the codebase as needed to address the feedback.
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
