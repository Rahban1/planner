#!/bin/sh
set -eu
: "${BITBUCKET_BASE_URL:?Set BITBUCKET_BASE_URL}"
: "${SCM_TOKEN:?Set SCM_TOKEN}"
export GIT_TERMINAL_PROMPT=0
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0="http.${BITBUCKET_BASE_URL%/}/.extraheader"
export GIT_CONFIG_VALUE_0="Authorization: Bearer ${SCM_TOKEN}"
exec "$@"
