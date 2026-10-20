require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { router: talhoesRouter } = require("./routes/talhoes");
const alertasRouter = require("./routes/alertas");
const insumosRouter = require("./routes/insumos");
const mercadoRouter = require("./routes/mercado");
const authRouter = require("./routes/auth");
const climaRouter = require("./routes/clima");
const relatoriosRouter = require("./routes/relatorios");
const notificacoesRouter = require("./routes/notificacoes");
const webhooksRouter = require("./routes/webhooks");
const { culturasSuportadas } = require("./services/rules");
const { inicializarBanco } = require("./services/db");
const { aplicarMigracoes } = require("./services/migracoes");
const { iniciarNotificacoes } = require("./services/notificacoes");
const { lerConfiguracao, modoDoCanal } = require("./services/notificacoes/config");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

// Log simples de requisições (útil pra depurar durante o desenvolvimento)
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString("pt-BR")}] ${req.method} ${req.path}`);
  next();
});

// Antes do parser JSON: os webhooks validam a assinatura sobre o corpo bruto.
app.use("/api/notificacoes/webhooks", webhooksRouter);
app.use(express.json());

app.get("/api/health", (req, res) => {
  const notificacoes = lerConfiguracao();
  res.json({
    status: "ok",
    modoClima: process.env.OPENWEATHER_API_KEY ? "real" : "simulado",
    modoIA: process.env.ANTHROPIC_API_KEY ? "real" : "simulado",
    modoMapas: "nominatim",
    modoEmail: modoDoCanal(notificacoes, "email"),
    modoSms: modoDoCanal(notificacoes, "sms"),
  });
});

app.get("/api/culturas", (req, res) => {
  res.json(culturasSuportadas());
});


app.use("/api/auth", authRouter);
app.use("/api/clima", climaRouter);
app.use("/api/talhoes", talhoesRouter);
app.use("/api/alertas", alertasRouter);
app.use("/api/insumos", insumosRouter);
app.use("/api/mercado", mercadoRouter);
app.use("/api/relatorios", relatoriosRouter);
app.use("/api/notificacoes", notificacoesRouter);

app.use((req, res) => {
  res.status(404).json({ erro: "Rota não encontrada" });
});

async function iniciar() {
  await inicializarBanco();
  await aplicarMigracoes();
  app.listen(PORT, () => {
    console.log("");
    console.log("  AgroAlerta - backend rodando em http://localhost:" + PORT);
    console.log("  Modo clima: " + (process.env.OPENWEATHER_API_KEY ? "REAL (OpenWeatherMap)" : "SIMULADO"));
    console.log("  Modo IA:    " + (process.env.ANTHROPIC_API_KEY ? "REAL (Anthropic)" : "SIMULADO"));
    console.log("  Modo mapas: OpenStreetMap (Nominatim, sem chave necessária)");
    const modos = iniciarNotificacoes();
    console.log("  E-mail:     " + modos.email.toUpperCase() + " · SMS: " + modos.sms.toUpperCase());
    console.log("");
  });
}

iniciar().catch((erro) => {
  console.error("Não foi possível conectar ao PostgreSQL:", erro.message);
  process.exit(1);
});
