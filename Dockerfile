FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./

RUN apt-get update && apt-get install -y python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm ci

COPY . .

RUN EDC_DATA_DIR=/tmp/edc-build-data npm run build

EXPOSE 3000

CMD ["node", "scripts/docker-entrypoint.js"]