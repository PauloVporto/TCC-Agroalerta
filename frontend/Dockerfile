FROM node:20-alpine

WORKDIR /app
COPY serve.js AgroAlerta.dc.html login.dc.html dashboard.dc.html support.js ./
COPY uploads/ ./uploads/

EXPOSE 5173
CMD ["node", "serve.js"]