FROM node:22-alpine

RUN npm install -g pnpm

WORKDIR /app

# Dependencies first (layer caching)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Only source code needed for the build
COPY . .

RUN pnpm build

EXPOSE 3000
CMD ["pnpm", "start"]