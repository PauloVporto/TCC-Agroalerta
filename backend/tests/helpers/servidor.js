const express = require("express");

// Sobe um app Express real em uma porta livre para testar as rotas via HTTP.
async function iniciarApp(montarRotas) {
  const app = express();
  app.use(express.json());
  montarRotas(app);

  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  return {
    url: `http://127.0.0.1:${servidor.address().port}`,
    fechar: () => new Promise((resolve) => servidor.close(resolve)),
  };
}

module.exports = { iniciarApp };
