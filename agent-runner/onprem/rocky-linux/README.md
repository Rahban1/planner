# Rocky Linux 9 deployment

This guide installs the Planner agent runner on one dedicated Rocky Linux 9 host. It uses Docker, Bitbucket Data Center, and Claude. The Planner web application can remain on Cloudflare.

The trusted supervisor can control Docker. This is a privileged role. Agent containers do not receive the Docker socket, the Bitbucket token, or the repository mirror. Use a dedicated virtual machine and a dedicated `planner-runner` account.

## Required information

Collect these values before installation:

- the Planner HTTPS URL;
- the Bitbucket Data Center base URL;
- a Bitbucket token with repository write and pull-request access;
- the shared Planner runner API token; and
- an Anthropic API key or an approved enterprise model gateway credential.

A Claude web or enterprise seat is not an API credential. Ask the company Claude administrator which API or gateway the runner must use.

## 1. Put this branch on the host

If the host can reach GitHub, run:

```bash
sudo git clone --branch ch/enterprise-rocky-bitbucket-claude --single-branch \
  https://github.com/Rahban1/planner.git /opt/planner
```

If GitHub is blocked, create a bundle on a computer that has this branch:

```bash
git bundle create planner-enterprise.bundle ch/enterprise-rocky-bitbucket-claude
```

Transfer the bundle through the approved company file-transfer system. Then run this on the Rocky Linux host:

```bash
sudo git clone planner-enterprise.bundle /opt/planner
sudo git -C /opt/planner switch ch/enterprise-rocky-bitbucket-claude
```

Do not copy `.env` or secret files from a personal computer.

## 2. Trust the company certificate authority

Complete this step only when Bitbucket, Planner, or the model gateway uses an internal certificate authority. Copy the approved CA file to the host and run:

```bash
sudo install -m 0644 company-root-ca.pem \
  /etc/pki/ca-trust/source/anchors/company-root-ca.pem
sudo update-ca-trust
sudo install -m 0644 company-root-ca.pem \
  /opt/planner/agent-runner/certs/company-root-ca.crt
```

The installer adds every `.crt` file in `agent-runner/certs` to both container images. The repository ignores these local certificate files. Do not commit a company certificate or set a TLS skip-verify option.

## 3. Run the installer

Docker, Git, Node.js 20 or later, npm, and systemd must already exist. Run:

```bash
sudo /opt/planner/agent-runner/onprem/rocky-linux/install.sh
```

The installer does these actions:

- creates the `planner-runner` service account;
- gives the trusted supervisor access to the Docker daemon;
- creates state and secret directories;
- installs dependencies and builds the runner;
- builds the two local images; and
- installs the systemd unit.

It does not overwrite configuration or secrets. It does not start the service.

Membership in the `docker` group permits control of host containers. Treat the `planner-runner` account as a privileged service account. Use rootless Docker instead when the enterprise platform team supplies it.

## 4. Set non-secret configuration

Edit `/etc/planner-runner/runner.env`. At minimum, set:

```text
PLANNER_BASE_URL=https://planner.example.com
SCM_PROVIDER=bitbucket_data_center
BITBUCKET_BASE_URL=https://bitbucket.example.com
LLM_MODEL=anthropic/claude-sonnet-5
LLM_API_BASE=
MAX_PARALLEL=2
CONTAINER_RUNTIME=docker
CONTAINER_SELINUX_LABEL=z
```

Keep `LLM_API_BASE` empty for the direct Anthropic API. If the company uses an approved model gateway, set its base URL and the model name required by that gateway.

Start with `MAX_PARALLEL=1` for acceptance. Change it to `2` after one complete pull-request flow succeeds. Each slot can use the CPU and memory values in `AGENT_CPUS` and `AGENT_MEMORY`.

## 5. Add secrets

Put only one secret value in each file:

```text
/etc/planner-runner/secrets/scm_token
/etc/planner-runner/secrets/llm_api_key
/etc/planner-runner/secrets/runner_api_token
```

Then set the owner and permissions:

```bash
sudo chown planner-runner:planner-runner /etc/planner-runner/secrets/*
sudo chmod 0600 /etc/planner-runner/secrets/*
```

Do not put secrets in `runner.env`, shell history, a Docker image, or the repository.

For the direct Anthropic API, verify the Claude key without printing it:

```bash
sudo -u planner-runner env \
  LLM_API_KEY_FILE=/etc/planner-runner/secrets/llm_api_key \
  node /opt/planner/agent-runner/onprem/rocky-linux/verify-claude.mjs
```

Do not use this check for a company gateway. Use the gateway health check supplied by the platform team.

## 6. Start and verify

Run:

```bash
sudo systemctl enable --now planner-runner
sudo systemctl status planner-runner --no-pager
sudo journalctl -u planner-runner -n 100 --no-pager
```

The supervisor stops before polling when a required secret, image, Docker connection, Planner connection, or Bitbucket setting is not valid.

Create one small Planner task that points to a Bitbucket test repository. Confirm this sequence:

1. The run changes from queued to running.
2. One OpenHands container and one trusted runner container start.
3. A branch with the `agent/` prefix appears in Bitbucket.
4. A pull request appears and contains proof results.
5. Temporary containers, the network, and the job volume are removed.
6. The bare mirror remains in `/var/lib/planner-runner/mirrors`.
7. Planner marks the run as merged after a human merges the pull request.

After this test passes, set `MAX_PARALLEL=2` and restart the service:

```bash
sudo systemctl restart planner-runner
```

## Update this branch

Stop the supervisor before an update. This prevents new jobs from starting during the build:

```bash
sudo systemctl stop planner-runner
sudo git -C /opt/planner pull --ff-only
sudo /opt/planner/agent-runner/onprem/rocky-linux/install.sh
sudo systemctl start planner-runner
```

Use an internal image registry and immutable image tags before a wider production rollout.
