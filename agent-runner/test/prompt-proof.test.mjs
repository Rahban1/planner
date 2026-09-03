import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPrompt } from '../dist/prompt.js'

const task = {
  title: 'Add a reset button',
  notes: 'Keep the count in local storage.',
  projectName: 'Proof fixture',
  repoUrl: 'https://github.com/example/proof-fixture',
  repoUrls: [
    'https://github.com/example/proof-fixture',
    'https://github.com/example/shared-api',
  ],
  priority: 'high',
  attachments: [],
}

test('implementation prompt requires the proof contract and reserves verification time', () => {
  const prompt = buildPrompt(task, { runId: 'run-123' })

  assert.match(prompt, /\.planner\/proof\/run-123\/manifest\.json/)
  assert.match(prompt, /PASS.*FAIL.*BLOCKED.*NOT RUN/s)
  assert.match(prompt, /at most 8 minutes/i)
  assert.match(prompt, /remaining.*testing.*evidence.*pull request/is)
  assert.match(prompt, /desktop.*mobile.*WebM/is)
  assert.match(prompt, /start the current branch locally/i)
  assert.match(prompt, /do not use a deployed production application/i)
  assert.match(prompt, /pnpm proof:ui/i)
  assert.match(prompt, /20 MB/i)
  assert.match(prompt, /ready pull request/i)
  assert.match(prompt, /do not claim.*100%/i)
  assert.match(prompt, /minimum sufficient matrix/i)
  assert.match(prompt, /do not repeat equivalent checks/i)
  assert.match(prompt, /skip.*unrelated.*NOT RUN/i)
  assert.match(prompt, /one verification command at a time/i)
  assert.match(prompt, /do not wrap them with `corepack`/i)
  assert.match(prompt, /timeout 120s/i)
  assert.match(prompt, /Never run the shell built-in `exit`/i)
  assert.match(prompt, /do not use `\/usr\/bin\/time`/i)
  assert.match(prompt, /write.*partial.*manifest.*before.*browser/is)
  assert.match(prompt, /browser.*blocked.*partial/is)
  assert.match(prompt, /Writable repositories:/)
  assert.match(
    prompt,
    /Repository 1: https:\/\/github\.com\/example\/proof-fixture/,
  )
  assert.match(
    prompt,
    /Repository 2: https:\/\/github\.com\/example\/shared-api/,
  )
  assert.match(
    prompt,
    /Clone https:\/\/github\.com\/example\/shared-api into `context-repos\/repo-2`/,
  )
  assert.match(prompt, /Every listed repository is writable/i)
  assert.match(prompt, /one ready Pull Request in each changed repository/i)
  assert.match(prompt, /\.git\/planner-agent-pr-url/)
})
