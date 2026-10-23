/**
 * Evolution API falsa: um servidor HTTP de verdade, numa porta livre, com o mesmo
 * contrato da v2.3.7 que o backend usa (rotas, apikey, corpos e erros). O teste
 * controla o estado — instância existente ou não, estado da conexão, número
 * conectado — e o roteiro das respostas de envio (atraso, conexão derrubada, erros).
 */

const express = require("express");

const ERRO = (status, mensagens) => ({ status, error: "Erro", response: { message: mensagens } });

async function iniciarEvolutionFalsa({ apiKey = "chave-de-teste", instancia = "agroalerta" } = {}) {
  const estado = {
    existe: true,
    conexao: "open",
    numero: "553599999503@s.whatsapp.net",
    perfil: "Agro Alerta",
    webhook: null,
    qrCode: "data:image/png;base64,QRCODE",
    // Cada item: { status, corpo } | { atrasoMs } | { derrubar: true }; sem roteiro, aceita.
    respostasEnvio: [],
    // Chamado com o corpo de cada envio antes da resposta (ex.: o administrador bloqueia agora).
    aoReceberEnvio: null,
  };
  const requisicoes = [];
  let mensagens = 0;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    requisicoes.push({ metodo: req.method, caminho: req.path, query: req.query, corpo: req.body, apikey: req.get("apikey") });
    if (req.get("apikey") !== apiKey) return res.status(401).json(ERRO(401, "Unauthorized"));
    next();
  });

  const existe = (nome) => estado.existe && nome === instancia;
  const naoExiste = (res) => res.status(404).json(ERRO(404, [`The "${instancia}" instance does not exist`]));

  app.get("/instance/connectionState/:nome", (req, res) =>
    existe(req.params.nome) ? res.json({ instance: { instanceName: instancia, state: estado.conexao } }) : naoExiste(res)
  );
  app.get("/instance/fetchInstances", (req, res) => {
    if (!existe(req.query.instanceName)) return naoExiste(res);
    res.json([
      {
        name: instancia, connectionStatus: estado.conexao, ownerJid: estado.numero, profileName: estado.perfil,
        token: "TOKEN-DA-INSTANCIA", disconnectionReasonCode: null, disconnectionAt: null,
      },
    ]);
  });
  app.post("/instance/create", (req, res) => {
    if (estado.existe) return res.status(403).json(ERRO(403, [`This name "${instancia}" is already in use.`]));
    estado.existe = true;
    estado.conexao = "close";
    estado.numero = null;
    res.status(201).json({ instance: { instanceName: req.body.instanceName, status: "close" } });
  });
  app.post("/webhook/set/:nome", (req, res) => {
    if (!existe(req.params.nome)) return naoExiste(res);
    estado.webhook = req.body.webhook;
    res.status(201).json(estado.webhook);
  });
  app.get("/webhook/find/:nome", (req, res) => (existe(req.params.nome) ? res.json(estado.webhook) : naoExiste(res)));
  app.get("/instance/connect/:nome", (req, res) => {
    if (!existe(req.params.nome)) return naoExiste(res);
    if (estado.conexao === "open") return res.json({ instance: { instanceName: instancia, state: "open" } });
    estado.conexao = "connecting";
    res.json({ pairingCode: null, code: "2@codigo", base64: estado.qrCode, count: 1 });
  });
  app.post("/instance/restart/:nome", (req, res) => res.json({ instance: { instanceName: instancia, status: estado.conexao } }));
  app.delete("/instance/logout/:nome", (req, res) => {
    estado.conexao = "close";
    res.json({ status: "SUCCESS", error: false, response: { message: "Instance logged out" } });
  });
  app.post("/message/sendText/:nome", async (req, res) => {
    if (!existe(req.params.nome)) return naoExiste(res);
    if (estado.aoReceberEnvio) await estado.aoReceberEnvio(req.body);
    const roteiro = estado.respostasEnvio.shift() || {};
    if (roteiro.atrasoMs) await new Promise((resolve) => setTimeout(resolve, roteiro.atrasoMs));
    if (roteiro.derrubar) return req.socket.destroy();
    if (roteiro.status) return res.status(roteiro.status).json(roteiro.corpo);
    mensagens += 1;
    res.status(201).json({
      key: { id: "MSG-" + mensagens, remoteJid: req.body.number + "@s.whatsapp.net", fromMe: true },
      status: "PENDING",
      message: { extendedTextMessage: { text: req.body.text } },
    });
  });

  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${servidor.address().port}`;
  return {
    url,
    estado,
    requisicoes,
    envios: () => requisicoes.filter((r) => r.caminho.startsWith("/message/sendText/")),
    env: { EVOLUTION_API_URL: url, EVOLUTION_API_KEY: apiKey, EVOLUTION_INSTANCE: instancia, WHATSAPP_SENDING_ENABLED: "true" },
    fechar: () =>
      new Promise((resolve) => {
        servidor.closeAllConnections();
        servidor.close(resolve);
      }),
  };
}

module.exports = { iniciarEvolutionFalsa, ERRO };
