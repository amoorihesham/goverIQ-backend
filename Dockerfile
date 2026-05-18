FROM node:22-alpine

WORKDIR /app

# Dependencies first (layer caching)
COPY package.json ./
RUN npm install 

# Only source code needed for the build
COPY . .

RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]