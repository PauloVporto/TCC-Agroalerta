/** Smoke test sem pareamento e sem envio, executado dentro do container isolado.
 * docker compose ... exec -T -e EVOLUTION_VALIDATION_ONLY=true evolution-api node < backend/scripts/validar-evolution.js
 * Repetir após restart com EVOLUTION_REQUIRE_EXISTING=true valida a instância persistida.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");

async function main() {
  assert.equal(process.env.EVOLUTION_VALIDATION_ONLY, "true", "Use somente no ambiente isolado de validação.");
  const key = fs.readFileSync("/run/secrets/evolution_api_key", "utf8").trim();
  const secret = require("node:crypto").createHash("sha256").update(key + ":isolated-webhook").digest("hex");
  const base = "http://127.0.0.1:8080";
  async function api(path, method = "GET", body) {
    const response = await fetch(base + path, {
      method, headers: { apikey: key, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
    });
    // v2.3.7 retorna 404 ao filtrar por instância ainda não criada.
    if (response.status === 404 && path.startsWith("/instance/fetchInstances?")) return [];
    assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
    return response.json();
  }
  const unauthorized = await fetch(base + "/instance/fetchInstances");
  assert.equal(unauthorized.status, 401);
  let instances = await api("/instance/fetchInstances?instanceName=agroalerta");
  if (process.env.EVOLUTION_REQUIRE_EXISTING === "true") {
    assert.ok(instances.some((i) => i.name === "agroalerta"), "Instância não persistiu após reinício.");
  } else if (!instances.some((i) => i.name === "agroalerta")) {
    await api("/instance/create", "POST", {
      instanceName: "agroalerta", integration: "WHATSAPP-BAILEYS", qrcode: false,
      rejectCall: false, groupsIgnore: true, alwaysOnline: false,
      readMessages: false, readStatus: false, syncFullHistory: false,
    });
  }
  const events = ["CONNECTION_UPDATE", "MESSAGES_UPDATE", "SEND_MESSAGE"];
  // Não há backend de produção nesta rede. Nenhuma conexão ao WhatsApp é iniciada.
  const url = "http://backend:3001/api/notificacoes/webhooks/evolution";
  if (process.env.EVOLUTION_REQUIRE_EXISTING !== "true") {
    await api("/webhook/set/agroalerta", "POST", {
      webhook: { enabled: true, url, headers: { jwt_key: secret }, byEvents: false, base64: false, events },
    });
  }
  const webhook = await api("/webhook/find/agroalerta");
  assert.equal(webhook.url, url);
  assert.equal(webhook.headers.jwt_key, secret);
  for (const event of events) assert.ok(webhook.events.includes(event));
  const state = await api("/instance/connectionState/agroalerta");
  assert.equal(state.instance.instanceName, "agroalerta");
  instances = await api("/instance/fetchInstances?instanceName=agroalerta");
  assert.equal(instances.filter((i) => i.name === "agroalerta").length, 1);
  console.log(JSON.stringify({ validado: true, instancia: "agroalerta", estado: state.instance.state,
    persistencia: process.env.EVOLUTION_REQUIRE_EXISTING === "true", pareamento: false, envios: 0 }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
