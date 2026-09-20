FROM node:22-slim

WORKDIR /app

# The runner pushes a committed fallback branch before it creates a PR.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src
RUN npm run build

ENV NODE_ENV=production
ENV RUNNER_WORKSPACE=/workspace/runs
ENV PLANNER_BASE_URL=http://host.docker.internal:3000
ENV OPENHANDS_BASE_URL=http://openhands-agent-server:8000
ENV LLM_MODEL=anthropic/claude-sonnet-5
ENV LLM_API_BASE=https://api.anthropic.com

CMD ["node", "dist/index.js"]
