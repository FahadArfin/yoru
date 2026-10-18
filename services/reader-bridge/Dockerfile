FROM cloudflare/cloudflared:latest@sha256:a15a3b50b8dabd57ac2090e9484c0247dba9dfa1f0df4d298d4317f9d69eb2d5 AS tunnel
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
WORKDIR /app
COPY --from=tunnel /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=tunnel /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY services/reader-bridge ./services/reader-bridge
COPY server/chapter-catalog.js server/validation.js ./server/
COPY shared/reader-connection.js ./shared/
COPY package.json ./package.json
RUN mkdir -p /data && chown node:node /data
USER node
CMD ["node", "services/reader-bridge/server.mjs"]
