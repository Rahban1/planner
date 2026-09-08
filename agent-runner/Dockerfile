FROM node:22-slim

WORKDIR /app

# The runner pushes a committed fallback branch before it creates a PR.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund

COPY src ./src
RUN npm run build

ENV NODE_ENV=production
ENV RUNNER_WORKSPACE=/workspace/runs
ENV PLANNER_BASE_URL=http://host.docker.internal:3000
ENV OPENHANDS_BASE_URL=http://openhands-agent-server:8000
ENV LLM_MODEL=openai/kimi-k2.6
ENV LLM_API_BASE=https://opencode.ai/zen/go/v1

CMD ["node", "dist/index.js"]
