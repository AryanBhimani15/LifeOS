# LifeOS — production image.
#
# Three stages so the thing that ships carries neither the source nor the build
# toolchain: deps installs, build compiles, runner holds only the standalone
# output. Works anywhere that runs a container — Azure Container Apps, Fly,
# Railway, Render — and is unnecessary on Vercel, which builds from the repo.
#
#   docker build -t lifeos .
#   docker run -p 3000:3000 --env-file .env.production lifeos
#
# Migrations are NOT run here. See docs/deployment.md: a container that migrates
# on boot will run several copies of the same migration when a host starts more
# than one instance.

FROM node:22-alpine AS deps
WORKDIR /app
# Only the manifests, so this layer is cached until dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The client is generated into src/generated/prisma, which is gitignored — so it
# has to be generated here rather than copied in.
RUN npx prisma generate
# A build-time placeholder. src/lib/auth.ts throws without it, and Next executes
# module scope while collecting pages. The real secret arrives at runtime.
ENV AUTH_SECRET=build-time-placeholder-not-used-at-runtime
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Runs as a non-root user: a container that is compromised should not also be
# root inside its own filesystem.
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Kept so `npx prisma migrate deploy` can be run against this image as a
# one-off job, from the same commit that built it.
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts

USER nextjs
EXPOSE 3000

# The app is only healthy when it can reach its database — see the route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
