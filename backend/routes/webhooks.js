const express = require("express");
const router = express.Router();
const { lerConfiguracao } = require("../services/notificacoes/config");
const { processarWebhookResend, processarWebhookSmsgo } = require("../services/notificacoes/statusEntrega");

// A assinatura é calculada sobre os bytes recebidos: o corpo não pode passar pelo
// express.json(). Por isso este roteador é montado antes do parser JSON global.
const corpoBruto = express.raw({ type: "*/*", limit: "256kb" });

function bytesDoCorpo(req) {
  return Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
}

function tratar(processar, segredo) {
  return async (req, res) => {
    try {
      const resultado = await processar({ cabecalhos: req.headers, corpoBruto: bytesDoCorpo(req), segredo: segredo() });
      res.status(resultado.status).json(resultado.corpo);
    } catch (erro) {
      console.error("[webhooks] falha ao processar:", erro.message);
      res.status(500).json({ erro: "Falha ao processar o webhook." });
    }
  };
}

// POST /api/notificacoes/webhooks/resend - eventos de entrega do Resend (assinatura Svix)
router.post("/resend", corpoBruto, tratar(processarWebhookResend, () => lerConfiguracao().email.resendWebhookSecret));

// POST /api/notificacoes/webhooks/smsgo - status de entrega da SMSGo (X-SMSGo-Signature)
router.post("/smsgo", corpoBruto, tratar(processarWebhookSmsgo, () => lerConfiguracao().sms.smsgo.webhookSecret));

module.exports = router;
