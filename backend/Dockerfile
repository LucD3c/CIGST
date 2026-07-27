# Contexto de build: la raiz del repositorio (necesita backend/ y los archivos
# estaticos del frontend index.html/app.js/styles.css/fonts que viven en la raiz).
# Version de Node fijada (no un tag flotante): actualizarla es una decision
# consciente, no un efecto colateral de un rebuild.

FROM node:20.20.2-alpine AS builder
WORKDIR /app
# El engine de Prisma necesita OpenSSL; Alpine no lo trae por defecto.
RUN apk add --no-cache openssl

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/prisma ./prisma
RUN npx prisma generate

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build


FROM node:20.20.2-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache openssl

RUN addgroup -S cigst && adduser -S cigst -G cigst

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/dist ./dist
COPY backend/prisma ./prisma

COPY index.html app.js styles.css ./public/
COPY fonts ./public/fonts

RUN chown -R cigst:cigst /app
USER cigst

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "dist/server.js"]
