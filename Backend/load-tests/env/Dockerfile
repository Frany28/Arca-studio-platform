# Imagen del backend y de las herramientas Node del entorno de carga (Fase 3).
# Contexto de construcción: el directorio Backend (ver docker-compose.yml). Nunca copia .env:
# Dockerfile.dockerignore lo excluye y server.mjs no carga dotenv.
FROM node:22-bookworm-slim

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.2 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY src ./src
COPY prisma ./prisma
COPY assets ./assets
COPY load-tests ./load-tests

ENV NODE_ENV=test
CMD ["node", "load-tests/env/server.mjs"]
