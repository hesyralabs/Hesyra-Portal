FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies including Prisma
RUN npm install

# Copy prisma schema and code
COPY prisma ./prisma
COPY . .

# Generate Prisma client for linux (Alpine)
RUN npx prisma generate

# Expose API port
EXPOSE 3001

# Start the server
CMD ["npm", "run", "start"]
