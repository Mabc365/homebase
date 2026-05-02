FROM node:20-slim

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# The app needs access to /var/run/docker.sock on the host
# This is usually handled via volume mapping in docker-compose

EXPOSE 3001

CMD ["node", "index.js"]
