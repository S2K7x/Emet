# Game server only (Railway, Fly, any Docker host). The client is deployed on Vercel.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --include-workspace-root --omit=dev
COPY server server
COPY shared shared
COPY data data
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
