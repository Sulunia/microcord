FROM node:22-alpine
RUN npm install -g npm@11
WORKDIR /app
EXPOSE 5173
CMD ["sh", "-c", "npm install && npx vite --host"]
