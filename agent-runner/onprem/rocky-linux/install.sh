#!/usr/bin/env bash
set -Eeuo pipefail

readonly INSTALL_ROOT="/opt/planner"
readonly SERVICE_USER="planner-runner"
readonly SERVICE_GROUP="planner-runner"
readonly CONFIG_ROOT="/etc/planner-runner"
readonly STATE_ROOT="/var/lib/planner-runner"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ ${EUID} -ne 0 ]]; then
  fail "Run this installer with sudo."
fi

[[ -r /etc/os-release ]] || fail "Cannot identify the operating system."
# shellcheck disable=SC1091
source /etc/os-release
[[ ${ID:-} == "rocky" ]] || fail "This installer supports Rocky Linux only."
[[ ${VERSION_ID%%.*} == "9" ]] || fail "This installer supports Rocky Linux 9 only."

for command_name in docker git node npm systemctl; do
  command -v "${command_name}" >/dev/null 2>&1 || \
    fail "Required command is missing: ${command_name}"
done

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
[[ ${node_major} =~ ^[0-9]+$ ]] || fail "Cannot read the Node.js version."
(( node_major >= 20 )) || fail "Node.js 20 or later is required."

[[ -d "${INSTALL_ROOT}/.git" ]] || \
  fail "Clone the Planner repository to ${INSTALL_ROOT} first."
[[ -f "${INSTALL_ROOT}/agent-runner/package.json" ]] || \
  fail "The agent-runner package is missing from ${INSTALL_ROOT}."

getent group docker >/dev/null 2>&1 || fail "The Docker group does not exist."
docker info >/dev/null 2>&1 || fail "The Docker daemon is not available."

if ! getent group "${SERVICE_GROUP}" >/dev/null 2>&1; then
  groupadd --system "${SERVICE_GROUP}"
fi
if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --gid "${SERVICE_GROUP}" --groups docker \
    --home-dir "${STATE_ROOT}" --create-home --shell /sbin/nologin \
    "${SERVICE_USER}"
else
  usermod --append --groups docker "${SERVICE_USER}"
fi

install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 \
  "${STATE_ROOT}" "${STATE_ROOT}/mirrors"
install -d -o root -g "${SERVICE_GROUP}" -m 0750 "${CONFIG_ROOT}"
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0700 \
  "${CONFIG_ROOT}/secrets"

if [[ ! -f "${CONFIG_ROOT}/runner.env" ]]; then
  install -o root -g "${SERVICE_GROUP}" -m 0640 \
    "${INSTALL_ROOT}/agent-runner/.env.onprem.example" \
    "${CONFIG_ROOT}/runner.env"
fi

for secret_name in scm_token llm_api_key runner_api_token; do
  secret_path="${CONFIG_ROOT}/secrets/${secret_name}"
  if [[ ! -e ${secret_path} ]]; then
    install -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0600 \
      /dev/null "${secret_path}"
  fi
done

npm --prefix "${INSTALL_ROOT}/agent-runner" ci --no-audit --no-fund
npm --prefix "${INSTALL_ROOT}/agent-runner" run build
docker build --tag planner-agent-runner:local \
  "${INSTALL_ROOT}/agent-runner"
docker build --tag planner-openhands-agent-server:local \
  --file "${INSTALL_ROOT}/agent-runner/Dockerfile.agent-server" \
  "${INSTALL_ROOT}/agent-runner"

install -o root -g root -m 0644 \
  "${INSTALL_ROOT}/agent-runner/onprem/planner-runner.service" \
  /etc/systemd/system/planner-runner.service
systemctl daemon-reload

printf '%s\n' \
  "Installation is complete." \
  "Set ${CONFIG_ROOT}/runner.env and the three secret files." \
  "Then run: sudo systemctl enable --now planner-runner"
