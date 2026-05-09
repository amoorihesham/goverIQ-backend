FROM node:24-alpine

WORKDIR /app

COPY package.json  /app/
COPY .npmrc /app/
RUN corepack enable \
    && npm install


COPY . .

RUN npm run build

CMD [ "npm", "run","worker"]
