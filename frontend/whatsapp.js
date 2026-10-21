"use strict";
(() => {
  const base = window.AGROALERTA_API_BASE || "http://localhost:3001/api";
  const $ = (id) => document.getElementById(id);
  let timer;
  let busy = false;
  const feedback = (text) => { $("feedback").textContent = text; };
  async function api(path, method = "GET", body) {
    const token = sessionStorage.getItem("agroalerta_token");
    const response = await fetch(base + path, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000),
    });
    const result = response.status === 204 ? {} : await response.json();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        clearInterval(timer);
        $("painel").hidden = true;
        $("login").hidden = false;
      }
      throw new Error(response.status === 403 ? "Acesso permitido somente a administradores autorizados." : result.erro || "Não foi possível concluir a operação.");
    }
    return result;
  }
  function render(state) {
    $("api-status").textContent = state.evolution.disponivel ? "Disponível" : state.evolution.erro || "Indisponível ou não configurada";
    $("instance").textContent = state.instancia;
    $("number").textContent = state.conexao.numero || "Nenhum número conectado";
    $("connection").textContent = ({ open: "Conectado", connecting: "Aguardando pareamento", close: "Desconectado" })[state.conexao.estado] || "Instância ainda não conectada";
    $("sender").textContent = state.conexao.remetenteValido ? "Confere com o remetente padrão" : "Aguardando número 9503 · envios bloqueados";
    $("webhook").textContent = state.webhook.emDia ? "Configurados" : "Aguardando configuração";
    $("sending").textContent = state.envioLiberado ? "Envios autorizados pela implantação e pelos controles administrativos." : state.motivoRetencao || "Envios bloqueados.";
    $("welcome").textContent = state.controle.boasVindasAtivas ? "Habilitadas no controle administrativo" : "Desativadas";
    $("frost").textContent = state.controle.alertasAtivos ? "Habilitados no controle administrativo" : "Desativados";
    const qr = state.conexao.qrCode;
    // Somente imagens PNG locais em base64; nunca carregar URLs devolvidas pelo provedor.
    const validQr = typeof qr === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(qr);
    $("qr").hidden = !validQr;
    if (validQr) $("qr").src = qr;
    else $("qr").removeAttribute("src");
    $("qr-hint").hidden = validQr;
    $("qr-hint").textContent = state.conexao.estado === "open" ? "WhatsApp conectado. Não é necessário escanear novamente." : state.conexao.estado === "connecting" ? "Aguardando a geração do QR Code. A página atualiza automaticamente." : "Clique em “Conectar e mostrar QR Code” para iniciar.";
    $("connect").disabled = state.conexao.estado === "open";
  }
  async function refresh() {
    const [state, summary, history] = await Promise.all([
      api("/admin/whatsapp"), api("/admin/notificacoes/resumo"), api("/admin/notificacoes?canal=whatsapp&limite=50"),
    ]);
    render(state);
    $("summary").textContent = `${summary.autorizados} produtores autorizados · ${summary.pendentes} pendentes · ${summary.aceitas} aceitas · ${summary.entregues} entregues · ${summary.lidas} lidas · ${summary.falhas} falhas · ${summary.incertas} incertas`;
    $("history").replaceChildren();
    for (const item of history.envios) {
      const row = document.createElement("tr");
      for (const value of [item.criadoEm ? new Date(item.criadoEm).toLocaleString("pt-BR") : "—", item.destino || "—", item.resumo || item.tipo, item.retidoEm ? "Retida: " + item.retencaoMotivo : item.status]) {
        const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
      }
      $("history").append(row);
    }
    if (!history.envios.length) {
      const row = document.createElement("tr"); const cell = document.createElement("td");
      cell.colSpan = 4; cell.textContent = "Nenhuma notificação de WhatsApp registrada.";
      row.append(cell); $("history").append(row);
    }
  }
  async function start() {
    const user = await api("/auth/me");
    if (user.papel !== "admin") throw new Error("Esta conta não possui permissão de administrador.");
    $("login").hidden = true; $("painel").hidden = false;
    await refresh();
    clearInterval(timer);
    timer = setInterval(() => { if (!busy && !document.hidden) refresh().catch((error) => feedback(error.message)); }, 8000);
  }
  async function action(button, path, method = "POST", body) {
    if (busy) return;
    busy = true; button.disabled = true; feedback("Aguarde…");
    try { await api(path, method, body); await refresh(); feedback("Estado atualizado."); }
    catch (error) { feedback(error.message); }
    finally { busy = false; button.disabled = false; }
  }
  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter; button.disabled = true;
    try {
      const result = await api("/auth/login", "POST", { email: $("email").value, senha: $("senha").value });
      $("senha").value = "";
      if (result.usuario.papel !== "admin") throw new Error("Esta conta não possui permissão de administrador.");
      sessionStorage.setItem("agroalerta_token", result.token);
      sessionStorage.setItem("agroalerta_usuario", JSON.stringify(result.usuario));
      feedback(""); await start();
    } catch (error) { feedback(error.message); }
    finally { button.disabled = false; }
  });
  $("connect").addEventListener("click", (event) => action(event.currentTarget, "/admin/whatsapp/conectar"));
  $("reconnect").addEventListener("click", (event) => action(event.currentTarget, "/admin/whatsapp/reconectar"));
  $("block").addEventListener("click", (event) => action(event.currentTarget, "/admin/whatsapp/controles", "PUT", { enviosBloqueados: true }));
  $("refresh").addEventListener("click", () => refresh().catch((error) => feedback(error.message)));
  $("logout").addEventListener("click", async () => {
    try { await api("/auth/logout", "POST"); } catch { /* Limpar também a sessão local expirada. */ }
    clearInterval(timer); sessionStorage.removeItem("agroalerta_token"); sessionStorage.removeItem("agroalerta_usuario");
    $("painel").hidden = true; $("login").hidden = false; feedback("");
  });
  if (sessionStorage.getItem("agroalerta_token")) start().catch((error) => { $("painel").hidden = true; $("login").hidden = false; feedback(error.message); });
  else $("login").hidden = false;
})();
