FROM node:22-slim

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src
RUN npm run build

ENV NODE_ENV=production
ENV RUNNER_WORKSPACE=/workspace/runs
ENV PLANNER_BASE_URL=http://host.docker.internal:3000
ENV OPENHANDS_BASE_URL=http://openhands-agent-server:8000
ENV LLM_MODEL=openai/kimi-k2.6
ENV LLM_API_BASE=https://opencode.ai/zen/go/v1

CMD ["node", "dist/index.js"]
