FROM node:20-alpine

WORKDIR /app
COPY price-monitor-api/package*.json ./
RUN npm ci --omit=dev
COPY price-monitor-api/ ./

ENV NODE_ENV=production
EXPOSE 8000
CMD ["npm", "start"]
