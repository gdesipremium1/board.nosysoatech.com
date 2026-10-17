# Build : dépendances + compilation Next.js (sortie "standalone").
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Exécution : image minimale, seulement le nécessaire pour lancer le serveur.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Persistés via des volumes (voir docker-compose.yml) : board.json/users.json
# et les fichiers uploadés doivent survivre à la recréation du conteneur.
RUN mkdir -p ./data ./public/uploads \
    && chown -R nextjs:nodejs ./data ./public/uploads

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
