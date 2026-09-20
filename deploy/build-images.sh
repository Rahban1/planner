#!/bin/sh
set -eu
: "${IMAGE_PREFIX:?Set IMAGE_PREFIX, for example registry.company.internal/planner}"
: "${IMAGE_TAG:?Set an immutable IMAGE_TAG, for example internal-1}"
PLATFORM=${PLATFORM:-linux/amd64}
cd "$(dirname "$0")/.."
docker build --platform "$PLATFORM" -f Dockerfile.internal -t "$IMAGE_PREFIX/app:$IMAGE_TAG" .
docker build --platform "$PLATFORM" -f agent-runner/Dockerfile.internal -t "$IMAGE_PREFIX/runner:$IMAGE_TAG" agent-runner
docker build --platform "$PLATFORM" -f agent-runner/Dockerfile.agent-server.internal -t "$IMAGE_PREFIX/agent-server:$IMAGE_TAG" agent-runner
docker push "$IMAGE_PREFIX/app:$IMAGE_TAG"
docker push "$IMAGE_PREFIX/runner:$IMAGE_TAG"
docker push "$IMAGE_PREFIX/agent-server:$IMAGE_TAG"
