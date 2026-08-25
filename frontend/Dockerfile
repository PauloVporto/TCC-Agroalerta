FROM node:20-alpine

WORKDIR /app
COPY serve.js index.html app.js styles.css config.example.js ./
RUN cp config.example.js config.js

EXPOSE 5173
CMD ["node", "serve.js"]