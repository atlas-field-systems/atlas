FROM node:24-alpine
WORKDIR /core
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
CMD ["node", "src/demo.mjs"]
