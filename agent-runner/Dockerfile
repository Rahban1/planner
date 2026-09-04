FROM node:22-slim

WORKDIR /app

# The runner pushes a committed fallback branch before it creates a PR.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

# Add approved enterprise certificate authorities before the image build.
# The certs directory is empty by default except for its documentation.
COPY certs/ /usr/local/share/ca-certificates/planner/
RUN if find /usr/local/share/ca-certificates/planner -type f -name '*.crt' \
    | grep -q .; then update-ca-certificates; fi

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund

COPY src ./src
RUN npm run build

ENV NODE_ENV=production
ENV RUNNER_WORKSPACE=/workspace/runs
ENV PLANNER_BASE_URL=http://host.docker.internal:3000
ENV OPENHANDS_BASE_URL=http://openhands-agent-server:8000
ENV LLM_MODEL=anthropic/claude-sonnet-5
ENV LLM_API_BASE=""
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

CMD ["node", "dist/index.js"]
