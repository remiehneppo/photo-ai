FROM node:20-alpine

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3001"]
