# Validation record

The local checks used synthetic data and test credentials.
No company service or production Planner database took part in these checks.

| Check | Result |
| --- | --- |
| TypeScript | PASS |
| ESLint | PASS. Two unchanged warnings in the generated Worker type file. |
| Cloudflare production build | PASS |
| Internal Node.js production build | PASS |
| App unit tests | PASS: 60 tests |
| Runner tests | PASS: 61 tests, including Bitbucket API contracts and revision checks |
| Internal production and storage tests | PASS: 4 tests |
| App, runner, and OpenHands image builds | PASS on Linux arm64 |
| App with a read-only root filesystem and no Linux capabilities | PASS |
| OpenHands as UID 1000, with no Linux capabilities | PASS |
| Chromium in the non-root OpenHands container | PASS |
| Runner connection to Planner and OpenHands | PASS with test credentials and an empty queue |
| Kustomize render and Kubernetes schema checks | PASS: 10 resources, with and without the private CA patch |
| Shell syntax | PASS |
| Browser project creation and task queue | PASS |
| Attachment upload, user download, and machine download | PASS |
| Attachment after app container restart | PASS |
| Access denial for a different account | PASS |
| Desktop and phone layout, search, and theme persistence | PASS. No browser script errors. |
| Missing proxy identity and incorrect machine token | PASS: requests denied |
| Cross-origin writes | PASS: requests denied |
| Database migration checksum and transaction rollback | PASS |
| Company Kubernetes cluster, ingress, storage class, and NetworkPolicy enforcement | NOT RUN: cluster access unavailable |
| Company OAuth2 Proxy sign-in | NOT RUN: company configuration unavailable |
| Real Bitbucket clone, push, pull request, revision, and merge | NOT RUN: company access unavailable |
| Real LLM plan and implementation | NOT RUN: company model access unavailable |
| Linux amd64 images | NOT RUN locally. The build script defaults to this platform. |

The Bitbucket tests use HTTP response fixtures. They do not prove company permissions or compatibility with your installed server version.

The browser check stopped its test run before any AI work. The screenshots therefore show a stopped run.

The workstation Git signature configuration blocked one original test commit.
The test passed with `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`.
No global Git configuration changed.

Proof images:

- [Desktop](proof/desktop.png)
- [Phone](proof/mobile.png)

Complete the company acceptance procedure in [the installation guide](INTERNAL_KUBERNETES.md) before normal use.
