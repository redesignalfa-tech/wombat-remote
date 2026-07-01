# Signaling server + web client only.
# The Electron host and nut.js run on the user's machine, never in the cloud,
# so we install just the two runtime deps the server needs and skip all scripts
# (no electron download, no native rebuilds).
FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install express ws --omit=dev --ignore-scripts

COPY server ./server
COPY client ./client

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/index.js"]
