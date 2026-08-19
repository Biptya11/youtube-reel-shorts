FROM node:20-bookworm

# whisper.cpp (used by nodejs-whisper) compiles from source on install,
# so we need build tools present in the image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git python3 python-is-python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["npm", "start"]
