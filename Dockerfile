FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy everything (filtered by .dockerignore)
COPY . .

ENV DATABASE_URL=postgresql://postgres:OZNUHHFLjybIoxnvt6Hl@107.155.122.35:5432/kingship

EXPOSE 8000

CMD ["node", "server.js"]
