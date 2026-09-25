# Bloom backend API + in-process reporter. Build from the REPO ROOT (it needs offchain/, deployments/, config/):
#   docker build -f backend/Dockerfile -t bloom-backend .
# Secrets come only from the host's environment variables at runtime; nothing is baked into the image.
FROM node:26-slim
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
RUN npm ci --prefix backend --omit=dev
COPY offchain/reporter/package.json offchain/reporter/package-lock.json offchain/reporter/
RUN npm ci --prefix offchain/reporter --omit=dev
COPY offchain offchain
COPY deployments deployments
COPY config config
COPY backend/src backend/src
COPY backend/data/contacts.json backend/data/contacts.json
# runtime JSON store (faucet ledger, claims, history): mount a persistent volume here
ENV BLOOM_DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
WORKDIR /app/backend
EXPOSE 3001
# hosting disks are often mounted root-owned: take ownership of the data dir, then run the API as the unprivileged
# "node" user (setpriv ships with Debian's util-linux, so no extra package)
CMD ["sh", "-c", "chown -R node:node \"$BLOOM_DATA_DIR\" 2>/dev/null; exec setpriv --reuid=node --regid=node --init-groups node src/index.ts"]
