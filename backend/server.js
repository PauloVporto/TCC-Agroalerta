require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { router: talhoesRouter } = require("./routes/talhoes");
const alertasRouter = require("./routes/alertas");
const insumosRouter = require("./routes/insumos");
const mercadoRouter = require("./routes/mercado");
const authRouter = require("./routes/auth");
const climaRouter = require("./routes/clima");
const { culturasSuportadas } = require("./services/rules");
const { inicializarBanco } = require("./services/db");

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
  res.json({
    status: "ok",
    modoClima: process.env.OPENWEATHER_API_KEY ? "real" : "simulado",
    modoIA: process.env.ANTHROPIC_API_KEY ? "real" : "simulado",
    modoMapas: process.env.GOOGLE_MAPS_API_KEY ? "real" : "simulado",
  });
});

app.get("/api/culturas", (req, res) => {
  res.json(culturasSuportadas());
});

// GET /api/config - configurações públicas do frontend.
// A chave do Google Maps aqui é a de uso client-side (Embed/JS API): ela é
// pensada para ficar visível no navegador e deve ser restrita por domínio/
// referrer no Console do Google, não por segredo no servidor.
app.get("/api/config", (req, res) => {
  const chave = (process.env.GOOGLE_MAPS_API_KEY || "").trim();
  res.json({ googleMapsApiKey: chave || null });
});

app.use("/api/auth", authRouter);
app.use("/api/clima", climaRouter);
app.use("/api/talhoes", talhoesRouter);
app.use("/api/alertas", alertasRouter);
app.use("/api/insumos", insumosRouter);
app.use("/api/mercado", mercadoRouter);

app.use((req, res) => {
  res.status(404).json({ erro: "Rota não encontrada" });
});

async function iniciar() {
  await inicializarBanco();
  app.listen(PORT, () => {
    console.log("");
    console.log("  AgroAlerta - backend rodando em http://localhost:" + PORT);
    console.log("  Modo clima: " + (process.env.OPENWEATHER_API_KEY ? "REAL (OpenWeatherMap)" : "SIMULADO"));
    console.log("  Modo IA:    " + (process.env.ANTHROPIC_API_KEY ? "REAL (Anthropic)" : "SIMULADO"));
    console.log("  Modo mapas: " + (process.env.GOOGLE_MAPS_API_KEY ? "REAL (Google Maps)" : "SIMULADO"));
    console.log("");
  });
}

iniciar().catch((erro) => {
  console.error("Não foi possível conectar ao PostgreSQL:", erro.message);
  process.exit(1);
});
