require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { router: talhoesRouter } = require("./routes/talhoes");
const alertasRouter = require("./routes/alertas");
const insumosRouter = require("./routes/insumos");
const mercadoRouter = require("./routes/mercado");
const authRouter = require("./routes/auth");
const painelRouter = require("./routes/painel");
const { culturasSuportadas } = require("./services/rules");
const { inicializarBanco } = require("./services/db");
const { fonteClimaAtiva } = require("./services/weather");
const { temChaveLlm } = require("./services/llm");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Log simples de requisições (útil pra depurar durante o desenvolvimento)
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString("pt-BR")}] ${req.method} ${req.path}`);
  next();
});

app.get("/api/health", (req, res) => {
  const fonteClima = fonteClimaAtiva();
  res.json({
    status: "ok",
    modoClima: fonteClima === "simulado" ? "simulado" : "real",
    fonteClima,
    modoMercado: "brasil+internacional",
    modoIA: temChaveLlm() ? "real" : "simulado",
    modoMapas: process.env.GOOGLE_MAPS_API_KEY ? "real" : "simulado",
  });
});

app.get("/api/culturas", (req, res) => {
  res.json(culturasSuportadas());
});

app.use("/api/auth", authRouter);
app.use("/api/talhoes", talhoesRouter);
app.use("/api/alertas", alertasRouter);
app.use("/api/insumos", insumosRouter);
app.use("/api/mercado", mercadoRouter);
app.use("/api/painel", painelRouter);

app.use((req, res) => {
  res.status(404).json({ erro: "Rota não encontrada" });
});

async function iniciar() {
  await inicializarBanco();
  app.listen(PORT, () => {
    console.log("");
  console.log("  AgroAlerta - backend rodando em http://localhost:" + PORT);
  console.log("  Modo clima:   REAL (" + fonteClimaAtiva() + ")");
  console.log("  Modo mercado: REAL (Brasil R$/saca + bolsas ICE/CBOT + PTAX)");
  console.log("  Modo IA:      " + (temChaveLlm() ? "REAL (Anthropic + contexto das APIs)" : "SIMULADO"));
  console.log("  Modo mapas:   " + (process.env.GOOGLE_MAPS_API_KEY ? "REAL (Google Maps)" : "SIMULADO"));
    console.log("");
  });
}

iniciar().catch((erro) => {
  console.error("Não foi possível conectar ao PostgreSQL:", erro.message);
  process.exit(1);
});
