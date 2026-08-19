FROM node:22-bookworm

# Build tools + Python required by youtube-dl-exec / Whisper
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install

# Copy application
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
