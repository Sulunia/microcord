FROM node:22-alpine
WORKDIR /app
EXPOSE 5173
CMD ["sh", "-c", "npm install && npx vite --host"]
