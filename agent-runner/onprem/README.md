# On-premises Bitbucket runner

This setup keeps the control plane separate from agent execution.

- The supervisor reads the Planner queue and starts a fixed number of jobs.
- Each job gets a private container network and a private workspace volume.
- The trusted runner owns the Bitbucket token. The OpenHands container does not receive it.
- A small trusted merge-check container updates merged and declined pull requests.
- The runner keeps one bare mirror for each repository. A run gets a fast local clone from the mirror.
- The agent commits to a local branch. The runner pushes the branch and creates the Bitbucket pull request.
- The agent does not receive the container socket. It cannot start other containers.

This is the recommended first deployment for Bitbucket Data Center. It changes only the runner. The Planner web application can stay on Cloudflare while the enterprise host connects to it by HTTPS.

## Requirements

- Linux with a rootless Docker or Podman service
- Node.js 20 or later
- Git
- Network access from the host to Planner, Bitbucket Data Center, and the LLM endpoint
- At least 8 GB of memory for one slot; 16 GB is a practical start for two slots

Do not run the agent on the main application server. Use a dedicated runner host or a dedicated virtual machine.

For Rocky Linux 9, use the focused installation guide in [`rocky-linux/README.md`](rocky-linux/README.md). It includes an installer, SELinux settings, internal CA setup, and an offline Git bundle path.

## Claude access

This branch uses `anthropic/claude-sonnet-5` by default. OpenHands uses the `provider/model` form for model names. Leave `LLM_API_BASE` empty to use the direct Anthropic API. Set it only when the company supplies an approved model gateway.

A Claude web or enterprise seat does not supply an API key to this service. Obtain an Anthropic API key or gateway credential through the company approval process. Store it only in `llm_api_key`.

## 1. Create a Bitbucket token

Create one Bitbucket Data Center project or repository HTTP access token for this integration. Give it repository write permission. This permission permits clone, push, and pull-request actions. Set an expiry date and record the owner and rotation date.

Use HTTPS repository URLs in Planner:

```text
https://bitbucket.example.com/scm/PROJECT/repository.git
```

The initial integration uses Bearer authentication. If the repository uses Git LFS, test it before rollout. Bitbucket Data Center has known Bearer and Git LFS limitations. A personal token with Basic authentication or an approved proxy configuration can be necessary for LFS.

## 2. Build fixed images

Run these commands from the Planner repository root:

```bash
docker build -t planner-agent-runner:local agent-runner
docker build -t planner-openhands-agent-server:local -f agent-runner/Dockerfile.agent-server agent-runner
```

Use immutable version tags in production. Do not use `latest`.

## 3. Install files

Copy the repository to `/opt/planner`. Create the state and secret directories:

```bash
sudo install -d -o planner-runner -g planner-runner -m 0750 /var/lib/planner-runner/mirrors
sudo install -d -o planner-runner -g planner-runner -m 0700 /etc/planner-runner/secrets
```

Create these three files. Put only the secret value in each file:

```text
/etc/planner-runner/secrets/scm_token
/etc/planner-runner/secrets/llm_api_key
/etc/planner-runner/secrets/runner_api_token
```

Set file permissions:

```bash
sudo chown planner-runner:planner-runner /etc/planner-runner/secrets/*
sudo chmod 0600 /etc/planner-runner/secrets/*
```

Copy `.env.onprem.example` to `/etc/planner-runner/runner.env`. Set the real non-secret URLs and image tags. Do not put tokens in this environment file.

On Rocky Linux with SELinux enabled, set `CONTAINER_SELINUX_LABEL=z`. The shared label is required because parallel job containers use the same trusted cache and secret directories. Do not disable SELinux.

`PLANNER_BASE_URL` is the URL that the host uses. If containers need a different route, set `PLANNER_CONTAINER_BASE_URL`. For example, a local Docker Desktop test can use `http://host.docker.internal:3000` for the container URL.

## 4. Run the preflight and supervisor

Build the TypeScript runner:

```bash
npm --prefix /opt/planner/agent-runner ci
npm --prefix /opt/planner/agent-runner run build
```

Start it manually for the first test:

```bash
set -a
. /etc/planner-runner/runner.env
set +a
npm --prefix /opt/planner/agent-runner run supervisor
```

Startup is a preflight. It stops before queue polling if:

- the container runtime is not available;
- an image is missing;
- a required secret file is missing;
- Planner authentication fails; or
- the Bitbucket base URL is missing.

Then create one small Planner task against a test repository. Confirm these results:

- The run changes from queued to running.
- One OpenHands container and one runner container start.
- A branch with the `agent/` prefix appears in Bitbucket.
- A ready pull request appears.
- The Planner run contains an honest proof result.
- Both job containers, the private network, and the job volume are removed after completion.
- The mirror remains in `/var/lib/planner-runner/mirrors` for the next run.
- Planner changes the run to merged after the pull request merges.

## 5. Install the service

Copy `planner-runner.service` to `/etc/systemd/system/`. Edit the user, paths, and rootless runtime configuration for the host. Then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now planner-runner
systemctl status planner-runner
journalctl -u planner-runner -f
```

## Capacity and parallel work

`MAX_PARALLEL` is the only concurrency control. Each slot has one OpenHands container and one small trusted runner container. Start with two slots. Increase it only when memory, CPU, Bitbucket load, and LLM rate limits are stable.

If the host restarts, Planner expires stale running jobs. A user can retry those jobs. A later hardening step can add durable job recovery if your enterprise requires automatic resume.

## Security controls

- Use a dedicated Linux account and a rootless container runtime.
- Do not mount the container socket into an agent container.
- Do not mount the repository mirror into an agent container.
- Permit the trusted runner to read the three secret files. Do not permit other users.
- Restrict outbound network traffic to Planner, Bitbucket, the LLM endpoint, approved package registries, and required test systems.
- Use a test Bitbucket project first. Add production repositories one at a time.
- Rotate the Bitbucket and Planner tokens on a fixed schedule.
- Review pull requests. The runner never merges them.

## Agent Canvas assessment

The August 2026 Agent Canvas update has useful operating patterns, but Planner does not need to adopt the Canvas user interface.

We use these patterns:

- deterministic scripts for polling, locking, caching, publication, and cleanup;
- visible queued, running, and failed states;
- startup preflight checks;
- isolated child workspaces; and
- human review of Git changes and proof.

We do not use Canvas Apps in this setup. They are beta and enabled apps run trusted JavaScript in the Agent Canvas browser context. Planner already provides the task, status, logs, and review interface. Adding Canvas would create another privileged interface without improving the secure execution boundary.
