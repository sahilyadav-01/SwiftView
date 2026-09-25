FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY public ./public
COPY server.js ./server.js
ENV NODE_ENV=production
EXPOSE 4173
CMD ["node", "server.js"]
