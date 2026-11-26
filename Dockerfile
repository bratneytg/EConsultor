# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS run
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 STATIC_DIR=/app/web DATA_FILE=/data/store.json
WORKDIR /app
# OCR para extractos en PDF de imágenes (Tesseract + poppler); si faltara, la importación sigue funcionando sin OCR.
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-spa tesseract-ocr-data-eng tesseract-ocr-data-deu tesseract-ocr-data-ita poppler-utils
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/web/dist ./web
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "dist/index.js"]
