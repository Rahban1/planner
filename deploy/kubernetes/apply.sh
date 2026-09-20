#!/bin/sh
set -eu
cd "$(dirname "$0")"
test -f secrets.env || { echo 'Copy secrets.env.example to secrets.env and set the secret values.' >&2; exit 1; }
if grep -Eq 'REPLACE_WITH|example\.(internal|com)' settings.env secrets.env kustomization.yaml; then
  echo 'Replace the example values in settings.env, secrets.env, and kustomization.yaml.' >&2
  exit 1
fi
# Validate locally before the cluster receives any resources.
kubectl kustomize . >/dev/null
kubectl apply -k .
kubectl -n planner rollout status deployment/planner --timeout=300s
kubectl -n planner rollout status deployment/planner-runner --timeout=600s
