FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js server-ai-settings.js server-messages.ko.cjs ./
COPY public ./public
COPY .env.example ./.env.example

ENV NODE_ENV=production
ENV PORT=5500
ENV DATA_DIR=/app/data

EXPOSE 5500

RUN mkdir -p /app/data

CMD ["node", "server.js"]
