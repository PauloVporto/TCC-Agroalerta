require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./swagger");

const { router: talhoesRouter } = require("./routes/talhoes");
const alertasRouter = require("./routes/alertas");
const insumosRouter = require("./routes/insumos");
const mercadoRouter = require("./routes/mercado");
const noticiasRouter = require("./routes/noticias");
const authRouter = require("./routes/auth");
const climaRouter = require("./routes/clima");
const relatoriosRouter = require("./routes/relatorios");
const notificacoesRouter = require("./routes/notificacoes");
const webhooksRouter = require("./routes/webhooks");
const adminRouter = require("./routes/admin");
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
    modoWhatsapp: modoDoCanal(notificacoes, "whatsapp"),
    monitoramentoClimatico: notificacoes.monitoramento.ativo ? "ativo" : "desligado",
  });
});

app.get("/api/culturas", (req, res) => {
  res.json(culturasSuportadas());
});

// Documentação interativa da API (Swagger UI), gerada a partir dos
// comentários @swagger nas rotas (ver swagger.js).
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/api-docs.json", (req, res) => res.json(swaggerSpec));


app.use("/api/auth", authRouter);
app.use("/api/clima", climaRouter);
app.use("/api/talhoes", talhoesRouter);
app.use("/api/alertas", alertasRouter);
app.use("/api/insumos", insumosRouter);
app.use("/api/mercado", mercadoRouter);
app.use("/api/noticias", noticiasRouter);
app.use("/api/relatorios", relatoriosRouter);
app.use("/api/notificacoes", notificacoesRouter);
app.use("/api/admin", adminRouter);

app.use((req, res) => {
  res.status(404).json({ erro: "Rota não encontrada" });
});

// Erro dentro de rota async vira rejeição não tratada e, por padrão, derruba o
// processo inteiro no Node 20. Aqui ele é apenas registrado: uma requisição com
// problema não pode deixar o backend fora do ar para todos os usuários.
process.on("unhandledRejection", (erro) => {
  console.error("[servidor] Rejeição não tratada:", erro);
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
    console.log("  Documentação (Swagger): http://localhost:" + PORT + "/api-docs");
    const modos = iniciarNotificacoes();
    console.log("  E-mail:     " + modos.email.toUpperCase() + " · WhatsApp: " + modos.whatsapp.toUpperCase());
    console.log("  Monitoramento climático automático: " + modos.monitoramento.toUpperCase());
    console.log("");
  });
}

iniciar().catch((erro) => {
  console.error("Não foi possível conectar ao PostgreSQL:", erro.message);
  process.exit(1);
});
