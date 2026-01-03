# Use the official Node.js runtime as base image
FROM node:18-alpine

# Set working directory in container
WORKDIR /app

# Copy package.json first (for better Docker layer caching)
COPY package.json .

# Copy all project files to container
COPY . .

# Expose the port the server runs on
EXPOSE 8000

# Start the server
CMD ["node", "server.js"]

