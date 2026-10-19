# Single image for both Railway services (api+web, worker). The start command differs per service.
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages ./packages
COPY server ./server
COPY app ./app
RUN npm install --no-audit --no-fund
RUN npm run build -w @hagel/app

FROM node:22-slim
# pg_dump 18 for the nightly backup (must be >= the Railway Postgres server version, currently 18)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=build /repo /repo
ENV NODE_ENV=production
WORKDIR /repo/server
EXPOSE 3000
# api+web: migrations run on boot inside createDb(); worker service overrides CMD with `npm run worker`
CMD ["npm", "run", "start"]
