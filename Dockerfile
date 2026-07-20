FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=production PORT=3002
EXPOSE 3002
CMD ["node", "index.js"]
