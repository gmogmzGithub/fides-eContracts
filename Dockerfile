# Imagen local de Fides: aplicación web, worker, migraciones, semilla,
# captura de mensajes y doble de revisión asistida comparten esta misma imagen.
# Sólo datos sintéticos; nunca contiene secretos ni datos personales.

# --- dependencias -----------------------------------------------------------
FROM node:22-alpine AS deps
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node
COPY --chown=node:node package.json .npmrc ./
# Resolución dentro de la imagen: Tailwind v4 y lightningcss instalan un binario
# nativo distinto por plataforma y el `package-lock.json` generado en macOS sólo
# conserva las variantes de Darwin. `package.json` fija las versiones exactas de
# Next y React, así que la imagen sigue siendo reproducible en Linux.
RUN npm install --no-audit --no-fund

# --- construcción -----------------------------------------------------------
FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY --chown=node:node . .
RUN npm run build

# --- ejecución --------------------------------------------------------------
# Conserva `scripts/`, `db/migrations/` y `node_modules` porque el worker, las
# migraciones y la semilla se ejecutan con Node plano desde la misma imagen.
FROM build AS runtime
USER root
RUN mkdir -p /var/lib/fides/objects /var/lib/fides/sink \
  && chown -R node:node /var/lib/fides
USER node

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3002 \
    HOSTNAME=0.0.0.0 \
    FIDES_OBJECT_DIR=/var/lib/fides/objects

# La salida `standalone` espera los estáticos y `public` junto a `server.js`.
RUN mkdir -p .next/standalone/public .next/standalone/.next/static \
  && cp -R public/. .next/standalone/public/ \
  && cp -R .next/static/. .next/standalone/.next/static/

EXPOSE 3002

CMD ["node", ".next/standalone/server.js"]
