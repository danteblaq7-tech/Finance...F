# Finesse API.
#   Build: docker build -t finesse-api ./backend
#   Run:   docker run --env-file backend/.env -e NODE_ENV=production -p 4000:4000 finesse-api
# The database schema is applied once from your own machine (npm run db:schema), not from the container.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://localhost:${PORT:-4000}/api/health || exit 1
CMD ["node", "src/server.js"]
