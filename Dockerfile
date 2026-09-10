# Alpha Market — single-image, single-port deployment (built for Fly.io).
#
# One container runs the Hono API *and* serves the built React dashboard on one
# port. This keeps everything that needs a warm, always-on process alive — the
# autonomous agent loop, the radar/brief scheduler, and the in-memory event log —
# which is exactly what serverless (Vercel) cannot do.
#
# NOTE: for the API to serve the frontend on the same port, the Hono server must
# serve $WEB_DIST as static files with an SPA fallback (one small code change,
# not yet applied). The web is built with VITE_API="" so it calls the API at the
# same origin (/chain, /agent, /feed) instead of the dev proxy's /api prefix.

# ---- builder: install workspace deps + build the web bundle ----
FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate
WORKDIR /app

# copy the whole workspace (.dockerignore keeps .env / node_modules / dist out)
COPY . .

# install all deps (dev deps included — vite builds the web, tsx runs the api)
RUN pnpm install --frozen-lockfile

# build the dashboard -> apps/web/dist (same-origin API calls)
RUN VITE_API="" pnpm --filter @alpha/web build

# ---- runtime: run the api, which also serves the built web ----
FROM node:22-slim AS runtime
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4021
ENV WEB_DIST=/app/apps/web/dist
# secrets (HEDERA_*, GRAPH_API_KEY, OPENAI_API_KEY, ...) come from `fly secrets`,
# never baked into the image.

COPY --from=builder /app /app

EXPOSE 4021
WORKDIR /app/apps/api
CMD ["pnpm", "start"]
