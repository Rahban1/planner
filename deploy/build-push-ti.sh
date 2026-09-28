#!/bin/sh
# Build and push the three planner images to TI Artifactory.
# Run from the planner repo root on a host that can reach artifactory.itg.ti.com.
#
# Usage:
#   docker login artifactory.itg.ti.com
#   IMAGE_TAG=20260927.1200-$(git rev-parse --short HEAD) ./deploy/build-push-ti.sh
set -eu

IMAGE_PREFIX="${IMAGE_PREFIX:-artifactory.itg.ti.com/docker-itsec-iam-local/planner}"
IMAGE_TAG="${IMAGE_TAG:?Set IMAGE_TAG, e.g. 20260927.1200-abc1234}"
PLATFORM="${PLATFORM:-linux/amd64}"

cd "$(dirname "$0")/.."

echo "Building planner/app  -> $IMAGE_PREFIX/app:$IMAGE_TAG"
docker build --platform "$PLATFORM" -f Dockerfile.internal \
  -t "$IMAGE_PREFIX/app:$IMAGE_TAG" .

echo "Building planner/runner -> $IMAGE_PREFIX/runner:$IMAGE_TAG"
docker build --platform "$PLATFORM" -f agent-runner/Dockerfile.internal \
  -t "$IMAGE_PREFIX/runner:$IMAGE_TAG" agent-runner

echo "Building planner/agent-server -> $IMAGE_PREFIX/agent-server:$IMAGE_TAG"
docker build --platform "$PLATFORM" -f agent-runner/Dockerfile.agent-server.internal \
  -t "$IMAGE_PREFIX/agent-server:$IMAGE_TAG" agent-runner

echo "Pushing images..."
docker push "$IMAGE_PREFIX/app:$IMAGE_TAG"
docker push "$IMAGE_PREFIX/runner:$IMAGE_TAG"
docker push "$IMAGE_PREFIX/agent-server:$IMAGE_TAG"

echo ""
echo "Done. Update the image tags in vks-dev-config:"
echo "  accounts/dev/namespaces/planner/kustomization.yaml"
echo "  Set newTag: \"$IMAGE_TAG\" for all three images."
