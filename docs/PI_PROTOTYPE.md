# Pi backend prototype

The prototype uses Pi as the backend agent for Planner. Pi Durable stores its checkpoints in SQLite. Pi coding-agent supplies the model runtime and file tools. The live model provider is OpenAI Codex. Your ChatGPT subscription supplies the model access through Pi OAuth.

Think of a task as a document with automatic saves. If the agent process fails, Pi opens the saved task and continues its work. A restart still requires the original database and repository files.

| Benefit                     | What it means for you                                   | Prototype result                                                                        |
| --------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Recovery after a crash      | You can resume the same task after the runner restarts. | PASS. A real process received SIGKILL. The next process used the same saved submission. |
| Retained progress           | The agent can keep completed work and repository files. | PASS. The completed repository read stayed in the transcript. Pi did not repeat it.     |
| Control of repeated actions | A crash does not automatically repeat every tool call.  | PASS. Pi reported an interrupted unsafe write. It did not repeat that write.            |
| A persistent stop           | A stopped task stays stopped after restart.             | PASS. The same submission stayed stopped.                                               |
| ChatGPT subscription access | Pi can use your plan through its OpenAI Codex login.    | PASS. A live task used the ChatGPT login on the host and inside the Pi container.        |

The prototype also checked a local service with a publication receipt. A receipt is a saved record that an action completed. After a crash, the tool returned the same receipt. The local service received one write. This check used a simulated service. It did not create a GitHub PR.

These results can reduce lost progress and manual recovery work. They do not prove that every task will be faster or cheaper. A model request cut short by a crash can repeat. Your ChatGPT plan still has usage limits.

The Pi backend uses `AGENT_ENGINE=pi`. It uses Pi coding-agent tools inside Pi Durable. This path does not call OpenHands or OpenCode. It does not use `LLM_API_KEY`, `LLM_API_BASE`, or `OPENAI_API_KEY`. It accepts only a Pi OAuth login for the OpenAI Codex provider.

Planner keeps task data and plan history in D1. Pi keeps agent execution state in SQLite. The runner connects both systems.

On startup, the Pi runner finds its saved runs and checks their Planner status. It resumes runs with status `running`. It retains the original repository workspace. A stopped or failed run does not resume automatically.

Pi provides `read`, `bash`, `edit`, and `write` tools. Questions use Pi read-only tools. Plan and implementation runs retain the current runner prompts and output files. Plan restrictions still depend on those prompts. The prototype needs stronger plan controls before production use.

The backend supports the runner interfaces for answers, plans, implementation, and PR revisions. The current proof checks and PR code still handle results. A native browser tool is not part of this prototype. A live repository plan passed. Live implementation, PR revisions, browser proof, and GitHub publication remain unverified.

Pi Durable is experimental. Its API can change. The prototype pins the Pi packages to version 1.0.0. Node.js 22.19.0 or later is required. One Pi runner owns each state directory. A storage lock permits only one process to open that directory.

The local recovery check needs no model key. From this worktree, run:

```bash
npm --prefix agent-runner ci
pnpm prototype:pi
```

The command creates scratch files under `.pi-prototype/`. It checks a plan, an unsafe write, a publication receipt, and a stop. Its final line gives the path to `report.json`.

To connect your ChatGPT account, run:

```bash
cd agent-runner
PI_AUTH_DIR=../.pi-prototype/auth npm run pi:login
```

Open the URL that Pi prints. Sign in with your ChatGPT account. Complete the provider consent step. Pi stores the OAuth credential in the private auth directory. Do not paste the credential into chat.

To check the login and create a live scratch plan, run:

```bash
PI_AUTH_DIR=../.pi-prototype/auth npm run pi:status
PI_AUTH_DIR=../.pi-prototype/auth npm run pi:live
```

The live check creates a small scratch repository. It asks Pi to read its README and write a plan. It uses your ChatGPT plan. It does not push code or create a PR.

For the backend prototype, start the local Planner app in another terminal. Use the local proof workflow in `docs/UI_PROOF.md`. Use a project and repository that you own. Then run this command from the worktree root:

```bash
docker compose --env-file .env.pi-prototype.example -f docker-compose.pi-prototype.yml up --build
```

Set the local runner token and GitHub token in a private env file when required. Use that private file in place of `.env.pi-prototype.example`. The prototype must use a local Planner URL. Its Docker volume retains SQLite and repository files. The auth directory must permit OAuth token refresh.

The Docker prototype supplies Git, ripgrep, Python, and the Node toolchain. It does not supply the complete browser image from the OpenHands backend. Application dependencies and browser tools need separate setup for live UI tasks.

The current checks prove local Pi recovery and live coding-tool execution with your ChatGPT login. A complete task acceptance check also needs real implementation, review, and PR checks.

Verification on 3 October 2026:

| Check | Result |
| --- | --- |
| Runner tests | PASS. All 55 tests passed. |
| Crash recovery and persistent stop | PASS. All four checks passed. |
| Lint and TypeScript | PASS. |
| Application production build | PASS. |
| Docker Compose configuration | PASS. |
| Docker image and container | PASS on 8 October 2026. The Pi image built. Chromium rendered a page. |
| Live ChatGPT task | PASS on 8 October 2026. Pi read a file and saved a plan on the host and inside Docker. |
| Live GitHub publication | NOT RUN. |

The recovery checks use a local model simulator with real Pi coding tools and Pi Durable storage. They do not measure live model quality or speed.

For the production runner, use `docker-compose.pi.yml`. It supplies GitHub CLI, Chromium, Playwright, and the project toolchain. It stores task state in the `planner-pi-workspace` volume. The host auth directory supplies the ChatGPT login and permits token refresh.

The production Worker uses `RUNNER_BACKEND=docker`. This value keeps tasks queued for the Pi runner. It prevents a second job in GitHub Actions. Run these commands from this worktree with your private env file:

```bash
docker compose --env-file /Users/rahbanghani/Documents/projects/planner/.env -f docker-compose.pi.yml up -d
pnpm run deploy
```

The Pi runner runs in Docker Desktop on this Mac. The Planner app runs on Cloudflare. Keep the Mac and Docker active while tasks run. Do not remove the state volume or auth directory.

The previous Worker version is `3492e64d-93d7-41af-b4d3-2938c62bf9c0`. To restore its task route, stop the Pi runner and use `pnpm exec wrangler rollback 3492e64d-93d7-41af-b4d3-2938c62bf9c0`. The previous route uses GitHub Actions. The Pi change needs no database migration.

Deployment completed on 8 October 2026. The live Worker version is `2a5d7381-68ea-49f6-9f16-6dd1b558b56f`. The source commit is `915fd40` on [ch/pi-durable-prototype](https://github.com/Rahban1/planner/tree/ch/pi-durable-prototype). The container `planner-pi-agent-runner` is healthy. The previous OpenHands containers are stopped.

The private acceptance task reached `plan_ready` with a 3,453-character plan. Its run ID is `85c79be5-0ec4-4afb-ae48-2df168b52638`. Pi used `openai-codex/gpt-6.1-sol` through your ChatGPT login. The cloned repository had no file changes. No GitHub Actions job or PR was created. The test project is archived.

D1 uses the existing `runner_backend=local` label for this bridge runner. The Pi startup log and saved run record confirm the Pi engine. The Worker setting `RUNNER_BACKEND=docker` controls task dispatch. Requests without the runner token receive HTTP 401.

Sources: [Pi Durable documentation](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md), [Pi provider documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md), and [OpenAI ChatGPT plan access in other tools](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites).
