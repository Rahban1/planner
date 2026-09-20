# Internal Kubernetes installation

This branch runs Planner without Cloudflare Workers, D1, R2, or GitHub Actions.

Use branch `ch/internal-kubernetes` when you copy the repository to Bitbucket.

The app starts with an empty database. It does not copy personal or production data.


The request path is: browser → TLS ingress → your OAuth2 Proxy pod → Planner.

The runner connects directly to Planner with a machine token.

The runner and OpenHands share one pod and one workspace volume.

OpenHands listens on loopback. It has no public Service.


## Required company values

You must supply these values. The repository cannot determine them:

- The public Planner hostname and TLS certificate.
- The registry path and image credentials, if the registry requires them.
- A storage class with a block volume and a local filesystem such as ext4 or XFS.
- Your OAuth2 Proxy configuration and pod labels.
- The Bitbucket Data Center base URL and two user access tokens.
- An Anthropic Console API key with access to the selected Claude model.
- The company CA bundle, if internal services use a private CA.

Use a Kubernetes CNI that enforces NetworkPolicy. This is required for proxy authentication.

Use one app replica and one runner replica. Do not add an HPA.

SQLite WAL requires a local filesystem on the volume. Do not use NFS or SMB.

The Recreate strategy stops the old pod before the replacement starts. Updates cause a short interruption.


The app uses Node.js 24.21.0. The browser needs no external font service.

Image builds need access to npm, PyPI, apt, and the base-image registries.

Agent tasks can need package registries. Configure company mirrors when public access is unavailable.


## 1. Copy the branch to Bitbucket

Create an empty internal repository. Then run:

```sh
git clone --branch ch/internal-kubernetes --single-branch git@github.com:Rahban1/planner.git planner-internal
cd planner-internal
git remote rename origin github-source
git remote add origin https://bitbucket.company.internal/scm/TEAM/planner.git
git push -u origin HEAD:main
```

Clone the internal repository on your build server:

```sh
git clone https://bitbucket.company.internal/scm/TEAM/planner.git
cd planner
```

Set the default branch to `main` in Bitbucket if necessary.

The code does not require GitHub after the copy.


## 2. Build and publish the three images

Use an immutable image tag for each release. Set the target platform to the cluster node architecture.

The default platform is `linux/amd64`.


```sh
docker login registry.company.internal
export IMAGE_PREFIX=registry.company.internal/planner
export IMAGE_TAG=internal-1
export PLATFORM=linux/amd64
./deploy/build-images.sh
```

For an isolated cluster, build on an approved connected host.

Transfer images with `docker save` and `docker load`, then publish them to the internal registry.

Do not transfer `.env` files from the personal checkout.


## 3. Set the deployment values

Edit `deploy/kubernetes/settings.env`:

- Set `APP_ORIGIN` to the public HTTPS origin, without a final slash.
- Set `BITBUCKET_BASE_URL` to your Bitbucket URL. Include its context path, if applicable.
- Keep `LLM_MODEL=anthropic/claude-sonnet-5` and `LLM_API_BASE=https://api.anthropic.com` for the direct Claude API.
- Keep `AUTH_MODE=oauth2_proxy` and `SCM_PROVIDER=bitbucket_data_center`.

The `anthropic/` prefix selects the Anthropic provider in OpenHands.

To use another Claude model, change `LLM_MODEL` and keep that prefix.

Allow outbound HTTPS from the runner pod to `api.anthropic.com` on port 443.

No OpenCode account or key is required. The default configuration sends model requests directly to Anthropic.

If your company requires a gateway, set `LLM_API_BASE` to its Anthropic-compatible base URL.


Create the local secret file:

```sh
umask 077
cp deploy/kubernetes/secrets.env.example deploy/kubernetes/secrets.env
openssl rand -hex 32
```

Put the generated token in `RUNNER_API_TOKEN`. Set the two Bitbucket tokens.

Put your Anthropic Console API key in `ANTHROPIC_API_KEY`. A Claude chat subscription is not an API key.

The runner receives this key from the Kubernetes Secret. It passes the key to OpenHands through loopback inside the runner pod.

The browser and Planner app container do not receive this key.

For an existing installation, replace the old `LLM_API_KEY` entry in `secrets.env` with `ANTHROPIC_API_KEY` before you apply this version.

The runner still accepts `LLM_API_KEY` for older custom deployments. For an Anthropic model, `ANTHROPIC_API_KEY` takes priority.

Use a Bitbucket user token for `SCM_TOKEN`, with clone, branch push, and pull-request permissions.

Use a separate read-only token for `BITBUCKET_READ_TOKEN`.

Both accounts need access to the repositories that Planner users select.

Git ignores `secrets.env`. Do not commit rendered manifests because they contain secrets.

Kustomize adds a content hash to each generated Secret and ConfigMap.

A configuration change therefore causes a pod replacement.


Edit the three image names and tags in `deploy/kubernetes/kustomization.yaml`.

If the cluster has no suitable default storage class, add `storageClassName` to both PVC specifications.

The initial volume requests are 10 GiB for app data and 30 GiB for workspaces.


For a private registry, create the namespace and pull secret:

```sh
kubectl apply -f deploy/kubernetes/namespace.yaml
kubectl -n planner create secret docker-registry registry-credentials \
  --docker-server=registry.company.internal \
  --docker-username=YOUR_USER \
  --docker-password=YOUR_REGISTRY_TOKEN
```

Use your company secret manager if available. Add this field to both pod specifications:

```yaml
imagePullSecrets:
  - name: registry-credentials
```

## 4. Connect your OAuth2 Proxy pod

Use OAuth2 Proxy as the reverse proxy for all browser requests to Planner.

Set these options in your current proxy configuration:

```text
--upstream=http://planner.planner.svc.cluster.local:3000/
--pass-user-headers=true
--skip-auth-strip-headers=true
--reverse-proxy=true
--cookie-secure=true
```

Keep your current provider, issuer, client ID, client secret, cookie secret, and allowed users or groups.

Set the callback URL to `https://YOUR_PLANNER_HOST/oauth2/callback`.

Do not configure an authentication bypass for Planner paths.

OAuth2 Proxy must replace `X-Forwarded-Email` with the authenticated email.

Planner uses that email for account identity and project membership.

It does not accept its old session cookie as a substitute for proxy identity.


Place the proxy in namespace `planner` with pod label `app.kubernetes.io/name: oauth2-proxy`.

The label must be on the pod template, not only the Deployment.

If the proxy is in another namespace, change the NetworkPolicy peer to include both selectors:

```yaml
- namespaceSelector:
    matchLabels:
      kubernetes.io/metadata.name: YOUR_PROXY_NAMESPACE
  podSelector:
    matchLabels:
      app.kubernetes.io/name: oauth2-proxy
```

These selectors must stay in the same list item.

The ingress example expects the proxy Service in namespace `planner`.

For another namespace, keep your current ingress route to that proxy.

Do not expose the Planner Service through a NodePort, LoadBalancer, or direct ingress.

Anyone with direct network access to Planner can supply a proxy identity header.

This design trusts cluster administrators and the runner.


Use your proxy to reject unauthorized company users and to control session expiry.

Planner still checks project membership for tasks, files, and reviews.

Users create projects and invite colleagues by their company email.


## 5. Add the company CA, if necessary

Create a ConfigMap from a PEM bundle that contains all required trusted roots:

```sh
kubectl -n planner create configmap planner-company-ca \
  --from-file=ca-bundle.crt=/path/to/company-ca-bundle.crt
```

Add the optional patch to `kustomization.yaml`:

```yaml
patches:
  - path: ca.example.patch.yaml
```

The patch supplies the CA to Node.js, Git, and Python.

Do not disable TLS verification.

Configure build-host trust separately if the image build also needs the company CA.


## 6. Start Planner

Check that kubectl points to the intended cluster:

```sh
kubectl config current-context
./deploy/kubernetes/apply.sh
kubectl -n planner get pods,pvc,svc
```

Edit the hostname, ingress class, proxy Service, and TLS Secret in `ingress.example.yaml`.

Then apply that file, or use your current company ingress:

```sh
kubectl apply -f deploy/kubernetes/ingress.example.yaml
```

The app applies each SQL migration once before it listens on port 3000.

Each migration has a checksum and a transaction. An altered applied migration stops startup.

No seed data enters the database.

Chat uses periodic refresh requests. This installation does not require Durable Objects or WebSockets.


## 7. Do the company acceptance test

1. Open the public HTTPS hostname. Check that OAuth2 Proxy requires sign-in.

2. Sign in with an allowed company account.

3. Create a project with a Bitbucket HTTPS clone URL, such as `https://HOST/scm/TEAM/repo.git`.

4. Create a task. Check that the runner returns a plan.

5. Approve the plan. Check that Bitbucket receives a new branch and pull request.

6. Open the review in Planner. Check the files and commit identity.

7. Request a change. Check that the same pull request receives the change.

8. Merge the pull request in Bitbucket. Check that Planner completes the task.

9. Upload an attachment. Download it and compare its contents.

10. Restart the app pod. Check that the task and attachment remain available.

11. Invite a second account. Check that a third account cannot access the project.

12. From a pod without the allowed labels, check that the Planner Service rejects network access.


The runner creates pull requests after it verifies the branch and proof files.

It never merges a pull request. Users approve and merge in Bitbucket.

A large or binary diff can have no inline preview. Open Bitbucket for the complete review.

The app does not infer merge permission from build status.


## Operations and recovery

```sh
kubectl -n planner logs deployment/planner --tail=100
kubectl -n planner logs deployment/planner-runner -c runner --tail=100
kubectl -n planner logs deployment/planner-runner -c agent-server --tail=100
kubectl -n planner describe pod POD_NAME
```

The app exposes `/health/live` and `/health/ready` for pod probes.

The readiness probe checks database access and the data path.

A runner restart can interrupt an active run. Stop that run in Planner, then retry it.

Do not start a second runner against the same workspace volume.

Drain active runs before an update. Keep the old image tags for rollback.


For a consistent backup, stop new requests and active runs first.

Scale both Deployments to zero. Snapshot the `planner-data` PVC through your storage system.

Alternatively, mount that PVC in a temporary maintenance pod and copy its complete contents.

Include the SQLite database, WAL files, and `files/` directory together.

Store the backup outside the cluster. Restart both Deployments after the backup completes.

The workspace PVC contains code and proof files. Back it up if your retention policy requires them.


Restore to an empty PVC with the same permissions and the correct application version.

Use UID and GID 1000. Start one app replica, then one runner replica.

Check a task and an attachment after restore.

Do not delete either PVC during an update. Do not run `kubectl delete -k` as an update step.

Database migrations can prevent rollback to older code. Restore a correct backup when required.


## Local validation

Use Node.js 24.21.0 for the internal runtime tests:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm exec tsc --noEmit
pnpm build
pnpm build:internal
pnpm test:internal
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 pnpm test
```

The production tests use a temporary database and test identity headers.

They do not connect to company services.

See `deploy/VALIDATION.md` for the checks from this branch.


## Reference

- [Claude models](https://platform.claude.com/docs/en/models/overview)

- [TanStack Start deployment](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)
- [OAuth2 Proxy options](https://oauth2-proxy.github.io/oauth2-proxy/7.8.x/configuration/overview/)
- [Kubernetes persistent volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- [Bitbucket Data Center pull requests](https://developer.atlassian.com/server/bitbucket/rest/v816/api-group-pull-requests/)
