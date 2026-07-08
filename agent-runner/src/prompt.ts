export interface TaskContext {
  title: string
  notes: string | null
  projectName: string
  repoUrl: string
  priority: string
}

export function buildPrompt(task: TaskContext): string {
  const branchName = `agent/${slug(task.title)}-${Date.now()}`

  return `You are an expert software engineer. Your job is to implement a task from a project planner and open a Pull Request for human review.

## Task

Project: ${task.projectName}
Priority: ${task.priority}
Title: ${task.title}
${task.notes ? `Notes: ${task.notes}` : ''}
Repository: ${task.repoUrl}

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

Begin by cloning ${task.repoUrl} and exploring the codebase.`
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}
