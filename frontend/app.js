const API_BASE = "http://localhost:3001/api";

const FASES_POR_CULTURA = {
  cafe: [
    { valor: "florada", texto: "Florada" },
    { valor: "floracao", texto: "Floração" },
    { valor: "granacao", texto: "Granação" },
    { valor: "maturacao", texto: "Maturação" },
    { valor: "colheita", texto: "Colheita" },
  ],
  soja: [
    { valor: "plantio", texto: "Plantio" },
    { valor: "vegetativo", texto: "Vegetativo" },
    { valor: "floracao", texto: "Floração" },
    { valor: "enchimento_graos", texto: "Enchimento de grãos" },
    { valor: "colheita", texto: "Colheita" },
  ],
  milho: [
    { valor: "plantio", texto: "Plantio" },
    { valor: "vegetativo", texto: "Vegetativo" },
    { valor: "floracao", texto: "Floração (pendoamento)" },
    { valor: "enchimento_graos", texto: "Enchimento de grãos" },
    { valor: "colheita", texto: "Colheita" },
  ],
  cana: [
    { valor: "plantio", texto: "Plantio / soqueira" },
    { valor: "desenvolvimento", texto: "Desenvolvimento vegetativo" },
    { valor: "maturacao", texto: "Maturação" },
    { valor: "colheita", texto: "Colheita" },
  ],
  feijao: [
    { valor: "plantio", texto: "Plantio" },
    { valor: "vegetativo", texto: "Vegetativo" },
    { valor: "floracao", texto: "Floração" },
    { valor: "enchimento_vagens", texto: "Enchimento de vagens" },
    { valor: "colheita", texto: "Colheita" },
  ],
};

const NOMES_CULTURA = {
  cafe: "Café",
  soja: "Soja",
  milho: "Milho",
  cana: "Cana-de-açúcar",
  feijao: "Feijão",
};

const ANO_INICIO = 2010;
const ANO_PROJECAO = 2027;
const ANO_PROJECAO_FIM = 2028;

const state = {
  talhoes: [],
  talhaoSelecionadoId: null,
  culturaMercadoAtual: "cafe",
  mercadoPeriodoAtual: "ano",
  mercadoAnoAtual: "todos",
  mercadoVisao: "comparar",
  mercadoBrasilCompleto: null,
  mercadoInternacionalCompleto: null,
  mercadoProjecao: null,
  mercadoHistoricoAnual: [],
  mercadoProjecaoMensal: [],
  mercadoProjecaoPorAno: {},
  mercadoAnosDisponiveis: [],
  anosProjecao: [ANO_PROJECAO, ANO_PROJECAO_FIM],
  anoProjecao: ANO_PROJECAO,
  anoProjecaoFim: ANO_PROJECAO_FIM,
  anoHistoricoFim: 2026,
  mercadoUnidade: "",
  authToken: null,
  usuario: null,
};

// ---------- AUTENTICAÇÃO ----------

function apiFetch(caminho, opcoes = {}) {
  const headers = { ...(opcoes.headers || {}) };
  if (state.authToken) headers["Authorization"] = "Bearer " + state.authToken;
  return fetch(API_BASE + caminho, { ...opcoes, headers });
}

function salvarSessao(token, usuario) {
  state.authToken = token;
  state.usuario = usuario;
  sessionStorage.setItem("agroalerta_token", token);
  sessionStorage.setItem("agroalerta_usuario", JSON.stringify(usuario));
}

function limparSessao() {
  state.authToken = null;
  state.usuario = null;
  sessionStorage.removeItem("agroalerta_token");
  sessionStorage.removeItem("agroalerta_usuario");
}

function restaurarSessao() {
  const token = sessionStorage.getItem("agroalerta_token");
  const usuarioJson = sessionStorage.getItem("agroalerta_usuario");
  if (token && usuarioJson) {
    state.authToken = token;
    state.usuario = JSON.parse(usuarioJson);
    return true;
  }
  return false;
}

function mostrarApp() {
  document.getElementById("authScreen").hidden = true;
  document.getElementById("appRoot").hidden = false;

  const nome = state.usuario?.nome || "";
  document.getElementById("userName").textContent = nome;
  document.getElementById("userAvatar").textContent = nome.charAt(0).toUpperCase() || "?";

  aplicarPapelUI();
  iniciarApp();
}

function papelAtual() {
  return state.usuario?.papel || "produtor";
}

function aplicarPapelUI() {
  const fornecedor = papelAtual() === "fornecedor";
  document.querySelectorAll("[data-nav-papel='produtor']").forEach((el) => {
    el.hidden = fornecedor;
  });
  const btnOferta = document.getElementById("btnNovaOferta");
  const boxOfertas = document.getElementById("minhasOfertasBox");
  if (btnOferta) btnOferta.hidden = !fornecedor;
  if (boxOfertas) boxOfertas.hidden = !fornecedor;
  if (fornecedor) {
    const ativo = document.querySelector(".nav-item.is-active");
    if (ativo && ativo.dataset.navPapel === "produtor") {
      document.querySelector('.nav-item[data-view="painel"]').click();
    }
  }
}

function mostrarLogin() {
  document.getElementById("authScreen").hidden = false;
  document.getElementById("appRoot").hidden = true;
}

// Alternância entre as abas de login/registro
document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("is-active"));
    document.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("is-active"));
    tab.classList.add("is-active");
    document.getElementById("form" + capitalizar(tab.dataset.form)).classList.add("is-active");
  });
});

function capitalizar(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

document.getElementById("formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(e.target).entries());
  const erroEl = document.getElementById("loginErro");
  erroEl.textContent = "";

  try {
    const resp = await fetch(API_BASE + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });
    const corpo = await resp.json();
    if (!resp.ok) throw new Error(corpo.erro || "Não foi possível entrar.");

    salvarSessao(corpo.token, corpo.usuario);
    mostrarApp();
  } catch (erro) {
    erroEl.textContent = erro.message;
  }
});

document.getElementById("registroPapel").addEventListener("change", () => {
  // cidade/celular ficam visíveis para produtor e fornecedor
});

document.getElementById("formRegistro").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(e.target).entries());
  const erroEl = document.getElementById("registroErro");
  erroEl.textContent = "";

  if (!dados.telefone || String(dados.telefone).replace(/\D/g, "").length < 10) {
    erroEl.textContent = "Informe um celular com DDD para receber os alertas por SMS.";
    return;
  }

  try {
    const resp = await fetch(API_BASE + "/auth/registrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });
    const corpo = await resp.json();
    if (!resp.ok) throw new Error(corpo.erro || "Não foi possível criar a conta.");

    salvarSessao(corpo.token, corpo.usuario);
    mostrarApp();
  } catch (erro) {
    erroEl.textContent = erro.message;
  }
});

document.getElementById("btnLogout").addEventListener("click", async () => {
  try {
    await apiFetch("/auth/logout", { method: "POST" });
  } catch (erro) {
    // mesmo se a chamada falhar, limpamos a sessão localmente
  }
  limparSessao();
  mostrarLogin();
});

// ---------- NAVEGAÇÃO ----------

document.getElementById("nav").addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-item");
  if (!btn) return;

  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");

  const view = btn.dataset.view;
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
  document.getElementById("view-" + view).classList.add("is-active");

  document.querySelector(".content").classList.toggle("content--full", view === "mercado");
  document.getElementById("sidebar").classList.remove("is-open");

  if (view === "painel") carregarPainel();
  if (view === "mensagens") carregarMensagens(true);
  if (view === "talhoes") {
    carregarTalhoes();
    setTimeout(garantirMapaTalhoes, 150);
  }
  if (view === "configuracoes") carregarConfiguracoes();
  if (view === "insumos") {
    carregarInsumos();
    if (papelAtual() === "fornecedor") carregarMinhasOfertas();
  }
  if (view === "mercado") carregarMercado(state.culturaMercadoAtual);
});

document.getElementById("btnMenu").addEventListener("click", () => {
  document.getElementById("sidebar").classList.toggle("is-open");
});

// ---------- CONFIGURAÇÕES DO USUÁRIO ----------

let configuracoesCarregadas = false;

async function carregarConfiguracoes() {
  if (configuracoesCarregadas) return;
  const resp = await apiFetch("/auth/configuracoes");
  if (!resp.ok) return;
  const dados = await resp.json();
  const perfil = document.getElementById("formPerfil");
  perfil.nome.value = dados.nome;
  perfil.email.value = dados.email;
  if (perfil.telefone) perfil.telefone.value = dados.telefone || "";
  if (perfil.cidade) perfil.cidade.value = dados.cidade || "";
  const preferencias = document.getElementById("formPreferencias");
  preferencias.culturaFavorita.value = dados.culturaFavorita;
  preferencias.unidadeTemperatura.value = dados.unidadeTemperatura;
  preferencias.notificacoes.checked = dados.notificacoes;
  configuracoesCarregadas = true;
}

function feedbackConfiguracao(id, mensagem, erro = false) {
  const el = document.getElementById(id);
  el.textContent = mensagem;
  el.classList.toggle("is-error", erro);
}

document.getElementById("formPerfil").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(e.target).entries());
  if (papelAtual() === "produtor" && (!dados.telefone || String(dados.telefone).replace(/\D/g, "").length < 10)) {
    return feedbackConfiguracao("perfilFeedback", "Informe o celular com DDD para receber SMS de alerta.", true);
  }
  const resp = await apiFetch("/auth/perfil", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados),
  });
  const corpo = await resp.json();
  if (!resp.ok) return feedbackConfiguracao("perfilFeedback", corpo.erro, true);
  state.usuario = corpo;
  sessionStorage.setItem("agroalerta_usuario", JSON.stringify(corpo));
  document.getElementById("userName").textContent = corpo.nome;
  document.getElementById("userAvatar").textContent = corpo.nome.charAt(0).toUpperCase();
  feedbackConfiguracao("perfilFeedback", "Perfil atualizado. Alertas vão para " + corpo.email + (corpo.telefone ? " e " + corpo.telefone : "") + ".");
});

document.getElementById("formPreferencias").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(e.target).entries());
  dados.notificacoes = e.target.notificacoes.checked;
  const resp = await apiFetch("/auth/preferencias", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados),
  });
  const corpo = await resp.json();
  if (resp.ok && dados.notificacoes) {
    await pedirPermissaoNotificacao();
  }
  feedbackConfiguracao("preferenciasFeedback", resp.ok ? "Preferências salvas." : corpo.erro, !resp.ok);
});

document.getElementById("formSenha").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(e.target).entries());
  const resp = await apiFetch("/auth/senha", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados),
  });
  const corpo = await resp.json();
  if (resp.ok) e.target.reset();
  feedbackConfiguracao("senhaFeedback", resp.ok ? corpo.mensagem : corpo.erro, !resp.ok);
});

document.getElementById("btnExcluirConta").addEventListener("click", async () => {
  if (!confirm("Excluir sua conta e todos os talhões permanentemente?")) return;
  const resp = await apiFetch("/auth/conta", { method: "DELETE" });
  if (resp.ok) {
    limparSessao();
    mostrarLogin();
  } else {
    alert("Não foi possível excluir a conta agora.");
  }
});

// ---------- STATUS (rodapé da sidebar) ----------

async function carregarStatus() {
  try {
    const resp = await fetch(API_BASE + "/health");
    const dados = await resp.json();
    definirPill("statusClima", dados.modoClima);
    definirPill("statusMercado", dados.modoMercado === "simulado" ? "simulado" : "real");
    definirPill("statusIA", dados.modoIA);
    definirPill("statusMapas", dados.modoMapas);
  } catch (erro) {
    console.error("Não foi possível conectar ao backend.", erro);
  }
}

function definirPill(id, modo, rotulo) {
  const el = document.getElementById(id);
  const real = modo && modo !== "simulado";
  el.textContent = rotulo && real ? String(rotulo) : real ? "real" : "simulado";
  el.classList.toggle("real", real);
}

function rotuloGeracaoIA(gerarPor) {
  if (gerarPor === "ia_clima_mercado" || gerarPor === "ia_com_busca") return "IA + clima/mercado";
  if (gerarPor === "ia_projecao") return "IA · projeção";
  if (gerarPor === "ia_clima") return "IA · clima";
  return "modo simulado";
}

function rotuloBriefing(gerarPor) {
  if (gerarPor === "ia_clima") return "IA";
  if (gerarPor === "simulado") return "simulado";
  return gerarPor || "—";
}

async function carregarPainel() {
  const kpis = document.getElementById("painelKpis");
  const alertasEl = document.getElementById("painelAlertas");
  const cotacoesEl = document.getElementById("painelCotacoes");
  const mensagensEl = document.getElementById("painelMensagens");
  try {
    const resp = await apiFetch("/painel");
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.erro || "Falha ao carregar o painel");

    const primeiroKpi = dados.papel === "fornecedor"
      ? `<div class="card kpi-card"><div class="kpi-label">Minhas ofertas</div><div class="kpi-value">${dados.totalOfertas || 0}</div></div>
         <div class="card kpi-card"><div class="kpi-label">Alertas de produtores</div><div class="kpi-value">—</div><div class="kpi-hint">Cadastre ofertas para aparecer nas recomendações</div></div>`
      : `<div class="card kpi-card"><div class="kpi-label">Talhões</div><div class="kpi-value">${dados.totalTalhoes}</div></div>
         <div class="card kpi-card"><div class="kpi-label">Alertas ativos</div><div class="kpi-value">${dados.totalAlertas}</div></div>`;

    kpis.innerHTML = `
      ${primeiroKpi}
      <div class="card kpi-card">
        <div class="kpi-label">Dólar PTAX</div>
        <div class="kpi-value">${dados.dolar ? "R$ " + Number(dados.dolar.valor).toFixed(2) : "—"}</div>
        <div class="kpi-hint">${dados.dolar ? dados.dolar.data : "sem cotação agora"}</div>
      </div>
      <div class="card kpi-card">
        <div class="kpi-label">IC-Br Agro</div>
        <div class="kpi-value">${dados.icBrAgro ? Number(dados.icBrAgro.valor).toFixed(1) : "—"}</div>
        <div class="kpi-hint">${dados.icBrAgro ? "índice BCB · " + dados.icBrAgro.data : "Brasil + bolsas"}</div>
      </div>
    `;

    if (dados.papel === "fornecedor") {
      if (mensagensEl) mensagensEl.innerHTML = '<p class="empty-state">Mensagens de clima são para contas de produtor.</p>';
      alertasEl.innerHTML = '<p class="empty-state">Como vendedor, publique ofertas em Insumos para aparecer nas recomendações dos produtores.</p>';
    } else {
      carregarMensagensResumoPainel();
      alertasEl.innerHTML = dados.alertas.length
        ? '<div class="painel-lista">' +
          dados.alertas
            .map(
              (a) =>
                `<button type="button" class="painel-row painel-row-btn" data-talhao="${a.talhaoId}"><span>${a.nome} · ${NOMES_CULTURA[a.cultura] || a.cultura}</span>` +
                `<span class="nivel-tag ${a.maiorNivel || "baixo"}">${a.total} alerta${a.total === 1 ? "" : "s"}</span></button>`
            )
            .join("") +
          "</div>"
        : '<p class="empty-state">Cadastre um talhão para ver alertas climáticos aqui.</p>';

      alertasEl.querySelectorAll("[data-talhao]").forEach((row) => {
        row.addEventListener("click", () => {
          document.querySelector('.nav-item[data-view="talhoes"]').click();
          selecionarTalhao(Number(row.dataset.talhao));
        });
      });
    }

    cotacoesEl.innerHTML =
      '<div class="painel-lista">' +
      Object.entries(dados.cotacoes)
        .map(([cultura, c]) => {
          const br = c && c.brasil ? "BR " + formatarMoeda(c.brasil.preco) : "BR —";
          const ext =
            c && c.internacional
              ? "INT " + c.internacional.preco + " " + c.internacional.unidade
              : "INT mercado interno";
          return (
            `<div class="painel-row painel-row-stack"><span>${NOMES_CULTURA[cultura] || cultura}</span>` +
            `<span class="painel-cotacao-duo">${br}<br>${ext}</span></div>`
          );
        })
        .join("") +
      "</div>";
  } catch (erro) {
    kpis.innerHTML = "";
    if (mensagensEl) mensagensEl.innerHTML = "";
    alertasEl.innerHTML = '<p class="empty-state">Não foi possível carregar a visão geral. Confira se o backend está no ar.</p>';
    cotacoesEl.innerHTML = "";
  }
}

// ---------- MENSAGENS DO PRODUTOR ----------

const stateMensagens = { idsNotificados: new Set(), ultimaSync: 0 };

function atualizarBadgeMensagens(naoLidas) {
  const badge = document.getElementById("badgeMensagens");
  if (!badge) return;
  if (naoLidas > 0) {
    badge.hidden = false;
    badge.textContent = naoLidas > 99 ? "99+" : String(naoLidas);
  } else {
    badge.hidden = true;
  }
}

function htmlMensagemCard(m) {
  const quando = m.atualizadoEm || m.criadoEm;
  const dataTxt = quando
    ? new Date(quando).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "";
  const talhao = m.talhaoNome ? m.talhaoNome + (m.cultura ? " · " + (NOMES_CULTURA[m.cultura] || m.cultura) : "") : "";
  const envio = rotuloEnvioMensagem(m);
  return (
    `<article class="mensagem-card ${m.nivel || "medio"}${m.lida ? "" : " is-unread"}" data-id="${m.id}" data-talhao="${m.talhaoId || ""}">` +
    `<div class="mensagem-card-top"><p class="mensagem-titulo">${escaparHtml(m.titulo)}</p>` +
    `<span class="nivel-tag ${m.nivel || "medio"}">${m.nivel || ""}</span></div>` +
    `<p class="mensagem-meta">${escaparHtml(talhao)}${talhao && dataTxt ? " · " : ""}${dataTxt}${m.lida ? "" : " · não lida"}</p>` +
    `<p class="mensagem-corpo">${escaparHtml(m.corpo)}</p>` +
    (m.recomendacao ? `<p class="mensagem-rec">${escaparHtml(m.recomendacao)}</p>` : "") +
    (envio ? `<p class="mensagem-envio">${envio}</p>` : "") +
    `</article>`
  );
}

function rotuloEnvioMensagem(m) {
  const partes = [];
  if (m.enviadoEmailEm || m.statusEmail) {
    const modo = m.statusEmail === "real" ? "e-mail enviado" : m.statusEmail === "simulado" ? "e-mail (simulado)" : m.statusEmail || "e-mail";
    partes.push(modo);
  }
  if (m.enviadoSmsEm || m.statusSms) {
    const modo = m.statusSms === "real" ? "SMS enviado" : m.statusSms === "simulado" ? "SMS (simulado)" : m.statusSms || "SMS";
    partes.push(modo);
  }
  if (!partes.length) return "Aguardando envio para e-mail/celular cadastrado";
  return "Entrega: " + partes.join(" · ");
}

function escaparHtml(texto) {
  return String(texto || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function pedirPermissaoNotificacao() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const resultado = await Notification.requestPermission();
  return resultado === "granted";
}

function dispararNotificacoesNavegador(mensagens, habilitado) {
  if (!habilitado || !("Notification" in window) || Notification.permission !== "granted") return;
  const novas = (mensagens || []).filter((m) => !m.lida && !stateMensagens.idsNotificados.has(m.id));
  novas.slice(0, 3).forEach((m) => {
    stateMensagens.idsNotificados.add(m.id);
    try {
      const n = new Notification("AgroAlerta · " + m.titulo, {
        body: m.corpo,
        tag: "agroalerta-" + m.id,
      });
      n.onclick = () => {
        window.focus();
        document.querySelector('.nav-item[data-view="mensagens"]')?.click();
      };
    } catch (_) {
      /* ignore */
    }
  });
}

async function carregarMensagens(sincronizar = false) {
  if (papelAtual() === "fornecedor") return;
  const lista = document.getElementById("mensagensLista");
  try {
    const qs = sincronizar ? "?sync=1" : "";
    const resp = await apiFetch("/mensagens" + qs);
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.erro || "Falha ao carregar mensagens");

    atualizarBadgeMensagens(dados.naoLidas || 0);
    dispararNotificacoesNavegador(dados.mensagens, dados.notificacoes);

    if (lista) {
      const contato = dados.contato || {};
      const canais = dados.canais || {};
      const banner =
        `<div class="mensagens-entrega-banner">` +
        `<strong>Entrega automática</strong> · e-mail: ${escaparHtml(contato.email || "—")} · celular: ${escaparHtml(contato.telefone || "cadastre em Configurações")} ` +
        `<span class="mensagens-canais">(SMTP ${canais.email || "simulado"} · SMS ${canais.sms || "simulado"})</span>` +
        `</div>`;

      if (!dados.mensagens.length) {
        lista.innerHTML =
          banner +
          '<p class="empty-state">Nenhuma mensagem ainda. Cadastre um talhão e clique em “Atualizar agora” para receber avisos de chuva, seca e outros riscos no e-mail e no celular.</p>';
      } else {
        lista.innerHTML = banner + dados.mensagens.map(htmlMensagemCard).join("");
        lista.querySelectorAll(".mensagem-card[data-talhao]").forEach((card) => {
          card.addEventListener("click", () => {
            const tid = Number(card.dataset.talhao);
            if (!tid) return;
            document.querySelector('.nav-item[data-view="talhoes"]').click();
            selecionarTalhao(tid);
          });
        });
      }
    }
    return dados;
  } catch (erro) {
    if (lista) lista.innerHTML = '<p class="empty-state">Não foi possível carregar as mensagens.</p>';
    return null;
  }
}

async function carregarMensagensResumoPainel() {
  const el = document.getElementById("painelMensagens");
  if (!el) return;
  const dados = await carregarMensagens(true);
  if (!dados) {
    el.innerHTML = '<p class="empty-state">Não foi possível buscar mensagens agora.</p>';
    return;
  }
  const top = (dados.mensagens || []).slice(0, 5);
  if (!top.length) {
    el.innerHTML = '<p class="empty-state">Sem mensagens no momento. Quando houver chuva forte, seca ou geada, elas aparecem aqui.</p>';
    return;
  }
  el.innerHTML =
    '<div class="painel-mensagens-lista">' +
    top
      .map(
        (m) =>
          `<button type="button" class="painel-msg-row${m.lida ? "" : " is-unread"}" data-abrir-mensagens="1">` +
          `<strong>${escaparHtml(m.titulo)}</strong>` +
          `<span>${escaparHtml(m.talhaoNome || "")}${m.talhaoNome ? " · " : ""}${escaparHtml((m.corpo || "").slice(0, 110))}${(m.corpo || "").length > 110 ? "…" : ""}</span>` +
          `</button>`
      )
      .join("") +
    "</div>" +
    (dados.naoLidas
      ? `<p class="kpi-hint" style="margin-top:10px">${dados.naoLidas} mensagem(ns) não lida(s) · <button type="button" class="linkish" data-abrir-mensagens="1">ver todas</button></p>`
      : `<p class="kpi-hint" style="margin-top:10px"><button type="button" class="linkish" data-abrir-mensagens="1">Abrir caixa de mensagens</button></p>`);

  el.querySelectorAll("[data-abrir-mensagens]").forEach((btn) => {
    btn.addEventListener("click", () => document.querySelector('.nav-item[data-view="mensagens"]').click());
  });
}

document.getElementById("btnAtualizarMensagens")?.addEventListener("click", async () => {
  const btn = document.getElementById("btnAtualizarMensagens");
  btn.disabled = true;
  btn.textContent = "Atualizando…";
  await carregarMensagens(true);
  btn.disabled = false;
  btn.textContent = "Atualizar agora";
});

document.getElementById("btnMarcarMensagensLidas")?.addEventListener("click", async () => {
  await apiFetch("/mensagens/lidas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  await carregarMensagens(false);
});


// ---------- TALHÕES ----------

async function carregarTalhoes() {
  const resp = await apiFetch("/talhoes");
  state.talhoes = await resp.json();
  renderizarListaTalhoes();
  atualizarMarcadoresMapa();

  if (state.talhoes.length > 0 && !state.talhaoSelecionadoId) {
    selecionarTalhao(state.talhoes[0].id);
  }
}

function renderizarListaTalhoes() {
  const lista = document.getElementById("talhoesList");

  if (state.talhoes.length === 0) {
    lista.innerHTML = '<p class="empty-state">Nenhum talhão cadastrado ainda.</p>';
    return;
  }

  lista.innerHTML = state.talhoes
    .map(
      (t) => `
      <div class="talhao-card ${t.id === state.talhaoSelecionadoId ? "is-selected" : ""}" data-id="${t.id}">
        <div class="talhao-card-nome">${t.nome}</div>
        <div class="talhao-card-meta">
          <span class="crop-dot ${t.cultura}"></span>
          ${NOMES_CULTURA[t.cultura] || t.cultura} · ${formatarFase(t.fase)}
        </div>
        ${t.enderecoFormatado || t.endereco ? `<div class="talhao-card-endereco">${t.enderecoFormatado || t.endereco}</div>` : ""}
      </div>
    `
    )
    .join("");

  lista.querySelectorAll(".talhao-card").forEach((card) => {
    card.addEventListener("click", () => selecionarTalhao(Number(card.dataset.id)));
  });
}

function formatarFase(fase) {
  return fase.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

async function selecionarTalhao(id) {
  state.talhaoSelecionadoId = id;
  renderizarListaTalhoes();
  atualizarMarcadoresMapa();

  const detalhe = document.getElementById("talhaoDetail");
  detalhe.innerHTML = '<div class="empty-state">Carregando clima e alertas…</div>';

  try {
    const resp = await apiFetch("/alertas/" + id);
    const dados = await resp.json();
    renderizarDetalheTalhao(dados);
  } catch (erro) {
    detalhe.innerHTML = '<div class="empty-state">Erro ao carregar dados do talhão.</div>';
  }
}

function renderizarFaixaPrevisao(previsao) {
  if (!previsao || previsao.length === 0) return "";
  const rotulos = { chuva: "Chuva", seco: "Seco", estavel: "Estável" };
  return (
    '<div class="previsao-strip">' +
    previsao
      .slice(0, 7)
      .map(
        (d) =>
          `<div class="previsao-dia previsao-${d.condicao}" title="${d.chuvaMm} mm · ${d.probabilidadeChuva || 0}% prob.">` +
          `<span class="previsao-data">${formatarData(d.data)}</span>` +
          `<span class="previsao-cond">${rotulos[d.condicao] || d.condicao}</span>` +
          `<span class="previsao-mm">${d.chuvaMm} mm</span>` +
          `</div>`
      )
      .join("") +
    "</div>"
  );
}

function renderizarDetalheTalhao(dados) {
  const { talhao, clima, alertas, briefing, previsao } = dados;
  const detalhe = document.getElementById("talhaoDetail");

  const alertasHtml =
    alertas.length === 0
      ? '<div class="sem-alertas">Nenhum risco identificado no momento para este talhão.</div>'
      : alertas
          .map((a) => {
            const insumosHtml =
              a.insumos && a.insumos.length
                ? '<div class="alerta-insumos"><div class="alerta-insumos-titulo">Insumos sugeridos</div>' +
                  a.insumos
                    .map((i) => {
                      const preco = i.melhorPreco
                        ? "R$ " + Number(i.melhorPreco.preco).toFixed(2) + " · " + (i.melhorPreco.fornecedor || "")
                        : "";
                      return `<div class="alerta-insumo">${i.nome} <span>${preco}</span></div>`;
                    })
                    .join("") +
                  "</div>"
                : "";
            return `
        <div class="alerta-item ${a.nivel}">
          <div class="alerta-top">
            <span class="alerta-titulo">${a.titulo}</span>
            <span class="nivel-tag ${a.nivel}">${a.nivel}</span>
          </div>
          <p class="alerta-msg">${a.mensagem}</p>
          <p class="alerta-rec">Recomendação: ${a.recomendacao}</p>
          ${insumosHtml}
        </div>
      `;
          })
          .join("");

  const areaHtml = talhao.areaHa
    ? `<div class="detail-area">Área mapeada: <strong>${Number(talhao.areaHa).toFixed(2)} ha</strong></div>`
    : "";

  const enderecoHtml = talhao.enderecoFormatado || talhao.endereco
    ? `<div class="detail-endereco">📍 ${talhao.enderecoFormatado || talhao.endereco}</div>`
    : "";

  const briefingHtml = briefing
    ? `<div class="briefing-card">
        <div class="briefing-titulo">Recado para o produtor <span class="badge">${rotuloBriefing(briefing.gerarPor)}</span></div>
        <p class="briefing-texto">${briefing.texto}</p>
      </div>`
    : "";

  detalhe.innerHTML = `
    <div class="detail-header">
      <div>
        <div class="detail-title">${escaparHtml(talhao.nome)}</div>
      </div>
      <span class="crop-dot ${talhao.cultura}"></span>
    </div>
    <div class="detail-sub">${NOMES_CULTURA[talhao.cultura] || talhao.cultura} · ${formatarFase(talhao.fase)} · fonte do clima: ${clima.fonte}</div>
    ${enderecoHtml}
    ${areaHtml}

    <form class="talhao-edit-card" id="formEditarTalhao">
      <div class="talhao-edit-titulo">Editar talhão</div>
      <p class="talhao-edit-hint">Atualize a cultura ou a fase conforme o ciclo da lavoura — os alertas passam a usar esses dados.</p>
      <label class="field"><span>Nome</span><input name="nome" value="${escaparHtml(talhao.nome)}" required /></label>
      <label class="field"><span>Cultura</span>
        <select name="cultura" id="editTalhaoCultura" required>
          ${Object.keys(NOMES_CULTURA)
            .map(
              (c) =>
                `<option value="${c}"${c === talhao.cultura ? " selected" : ""}>${NOMES_CULTURA[c]}</option>`
            )
            .join("")}
        </select>
      </label>
      <label class="field"><span>Fase da cultura</span>
        <select name="fase" id="editTalhaoFase" required></select>
      </label>
      <p class="form-feedback" id="editTalhaoFeedback"></p>
      <div class="talhao-edit-actions">
        <button type="submit" class="btn btn-primary" id="btnSalvarTalhao">Salvar alterações</button>
      </div>
    </form>

    ${briefingHtml}
    <div class="previsao-titulo">Previsão 7 dias (chuva / seco)</div>
    ${renderizarFaixaPrevisao(previsao)}

    <div class="clima-grid">
      <div class="clima-metric">
        <div class="clima-metric-label">Temp. mínima</div>
        <div class="clima-metric-value">${clima.temperaturaMinima}°C</div>
      </div>
      <div class="clima-metric">
        <div class="clima-metric-label">Chuva 7 dias</div>
        <div class="clima-metric-value">${clima.chuvaAcumulada7dias}mm</div>
      </div>
      <div class="clima-metric">
        <div class="clima-metric-label">Dias sem chuva</div>
        <div class="clima-metric-value">${clima.diasSemChuva}</div>
      </div>
      <div class="clima-metric">
        <div class="clima-metric-label">Vento máx.</div>
        <div class="clima-metric-value">${clima.ventoMaximoKmh} km/h</div>
      </div>
    </div>

    <div class="alertas-title">Alertas ativos</div>
    ${alertasHtml}
    <div class="detail-actions">
      <button type="button" class="btn btn-ghost" id="btnAtualizarAlertas">Atualizar clima e alertas</button>
      <button type="button" class="btn btn-danger" id="btnExcluirTalhao">Excluir talhão</button>
    </div>
  `;

  preencherFasesEdicao(talhao.cultura, talhao.fase);
  const selCulturaEdit = document.getElementById("editTalhaoCultura");
  if (selCulturaEdit) {
    selCulturaEdit.addEventListener("change", () => {
      preencherFasesEdicao(selCulturaEdit.value, null);
    });
  }

  const formEdit = document.getElementById("formEditarTalhao");
  if (formEdit) {
    formEdit.addEventListener("submit", async (e) => {
      e.preventDefault();
      await salvarEdicaoTalhao(talhao.id, formEdit);
    });
  }

  const btnAtualizar = document.getElementById("btnAtualizarAlertas");
  if (btnAtualizar) btnAtualizar.addEventListener("click", () => selecionarTalhao(talhao.id));
  const btnExcluir = document.getElementById("btnExcluirTalhao");
  if (btnExcluir) btnExcluir.addEventListener("click", () => excluirTalhao(talhao.id, talhao.nome));
}

function preencherFasesEdicao(cultura, faseSelecionada) {
  const select = document.getElementById("editTalhaoFase");
  if (!select) return;
  const fases = FASES_POR_CULTURA[cultura] || [];
  select.innerHTML = fases
    .map((f) => `<option value="${f.valor}">${f.texto}</option>`)
    .join("");
  if (faseSelecionada && fases.some((f) => f.valor === faseSelecionada)) {
    select.value = faseSelecionada;
  }
}

async function salvarEdicaoTalhao(id, form) {
  const feedback = document.getElementById("editTalhaoFeedback");
  const btn = document.getElementById("btnSalvarTalhao");
  const dados = Object.fromEntries(new FormData(form).entries());
  if (feedback) {
    feedback.textContent = "";
    feedback.classList.remove("is-error");
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Salvando…";
  }
  try {
    const resp = await apiFetch("/talhoes/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: String(dados.nome || "").trim(),
        cultura: dados.cultura,
        fase: dados.fase,
      }),
    });
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(corpo.erro || "Não foi possível salvar o talhão.");

    const idx = state.talhoes.findIndex((t) => t.id === id);
    if (idx >= 0) state.talhoes[idx] = { ...state.talhoes[idx], ...corpo };
    if (feedback) feedback.textContent = "Talhão atualizado. Recarregando alertas…";
    await carregarTalhoes();
    await selecionarTalhao(id);
  } catch (erro) {
    if (feedback) {
      feedback.textContent = erro.message;
      feedback.classList.add("is-error");
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Salvar alterações";
    }
  }
}

async function excluirTalhao(id, nome) {
  if (!confirm("Excluir o talhão \"" + nome + "\" e os alertas associados?")) return;
  const resp = await apiFetch("/talhoes/" + id, { method: "DELETE" });
  if (!resp.ok) {
    alert("Não foi possível excluir o talhão.");
    return;
  }
  state.talhaoSelecionadoId = null;
  document.getElementById("talhaoDetail").innerHTML =
    '<div class="empty-state"><p>Selecione um talhão à esquerda para ver o clima e os alertas.</p></div>';
  await carregarTalhoes();
}

// ---------- MODAL NOVO TALHÃO ----------

const modalOverlay = document.getElementById("modalOverlay");
const formTalhao = document.getElementById("formTalhao");
const selectCultura = formTalhao.querySelector('[name="cultura"]');
const selectFase = formTalhao.querySelector('[name="fase"]');

function preencherFases() {
  const cultura = selectCultura.value;
  selectFase.innerHTML = FASES_POR_CULTURA[cultura]
    .map((f) => `<option value="${f.valor}">${f.texto}</option>`)
    .join("");
}

selectCultura.addEventListener("change", preencherFases);
preencherFases();

document.getElementById("btnNovoTalhao").addEventListener("click", () => {
  modalOverlay.classList.add("is-open");
  setTimeout(() => {
    garantirMapaCadastro();
    if (cadastroMapaState.mapa) cadastroMapaState.mapa.invalidateSize();
    document.getElementById("talhaoEndereco").focus();
  }, 150);
});
document.getElementById("btnLocalizarEndereco").addEventListener("click", () => localizarEnderecoNoMapa());
document.getElementById("talhaoEndereco").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    localizarEnderecoNoMapa();
  }
});
document.getElementById("btnFecharModal").addEventListener("click", fecharModal);
document.getElementById("btnCancelarModal").addEventListener("click", fecharModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) fecharModal();
});

function fecharModal() {
  modalOverlay.classList.remove("is-open");
  formTalhao.reset();
  preencherFases();
  limparCadastroMapa();
  const enderecoResolvido = document.getElementById("enderecoResolvido");
  enderecoResolvido.hidden = true;
  enderecoResolvido.textContent = "";
  enderecoResolvido.classList.remove("is-error");
}

function feedbackEndereco(mensagem, erro = false) {
  const el = document.getElementById("enderecoResolvido");
  el.hidden = false;
  el.textContent = mensagem;
  el.classList.toggle("is-error", erro);
}

async function localizarEnderecoNoMapa() {
  const input = document.getElementById("talhaoEndereco");
  const endereco = input.value.trim();
  if (!endereco) {
    feedbackEndereco("Informe o endereço da propriedade.", true);
    input.focus();
    return;
  }

  garantirMapaCadastro();
  feedbackEndereco("Buscando endereço no mapa…");

  try {
    const resp = await apiFetch("/talhoes/geocodificar?endereco=" + encodeURIComponent(endereco));
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.erro || "Endereço não encontrado.");

    input.value = dados.enderecoFormatado || endereco;
    feedbackEndereco("Localizado: " + (dados.enderecoFormatado || endereco));

    const latlng = L.latLng(dados.latitude, dados.longitude);
    cadastroMapaState.mapa.setView(latlng, 15);
    definirPontoCadastro(latlng, true);
    if (cadastroMapaState.marcador) {
      cadastroMapaState.marcador.bindPopup(dados.enderecoFormatado || endereco).openPopup();
    }
    atualizarHintCadastro("Endereço localizado. Ajuste o ponto no mapa ou delimite a área do talhão.");
  } catch (erro) {
    feedbackEndereco(erro.message || "Não foi possível localizar esse endereço.", true);
  }
}

async function garantirCoordenadasCadastro(dados) {
  if (dados.latitude && dados.longitude) return dados;

  const endereco = String(dados.endereco || "").trim();
  if (!endereco) return dados;

  const resp = await apiFetch("/talhoes/geocodificar?endereco=" + encodeURIComponent(endereco));
  const coords = await resp.json();
  if (!resp.ok) throw new Error(coords.erro || "Não foi possível localizar o endereço informado.");

  dados.latitude = String(coords.latitude);
  dados.longitude = String(coords.longitude);
  dados.endereco = coords.enderecoFormatado || endereco;
  return dados;
}

formTalhao.addEventListener("submit", async (e) => {
  e.preventDefault();
  let dados = Object.fromEntries(new FormData(formTalhao).entries());

  if (!String(dados.endereco || "").trim()) {
    alert("Informe o endereço da propriedade.");
    return;
  }

  const botao = formTalhao.querySelector('button[type="submit"]');
  botao.disabled = true;
  botao.textContent = "Cadastrando…";

  try {
    dados = await garantirCoordenadasCadastro(dados);

    if (!dados.latitude || !dados.longitude) {
      alert("Localize o endereço no mapa antes de cadastrar.");
      return;
    }

    if (cadastroMapaState.poligono && cadastroMapaState.poligono.length >= 3) {
      dados.poligono = cadastroMapaState.poligono;
    }

    const resp = await apiFetch("/talhoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });

    if (!resp.ok) throw new Error("Falha ao cadastrar talhão");

    const novoTalhao = await resp.json();
    fecharModal();
    await carregarTalhoes();
    selecionarTalhao(novoTalhao.id);
  } catch (erro) {
    alert(erro.message || "Não foi possível cadastrar o talhão. Verifique o endereço e se o backend está no ar.");
  } finally {
    botao.disabled = false;
    botao.textContent = "Cadastrar talhão";
  }
});

// ---------- INSUMOS ----------

async function carregarInsumos(categoria = "") {
  const url = API_BASE + "/insumos" + (categoria ? "?categoria=" + categoria : "");
  const resp = await fetch(url);
  const insumos = await resp.json();
  state.insumosCarregados = true;

  const grid = document.getElementById("insumosGrid");
  grid.innerHTML = insumos
    .map(
      (insumo) => `
      <div class="insumo-card">
        <div class="insumo-nome">${insumo.nome}</div>
        <div class="insumo-unidade">preço por ${insumo.unidade}</div>
        ${insumo.ofertas
          .map(
            (o, i) => `
          <div class="oferta-row ${i === 0 ? "melhor" : ""}">
            <div>
              <span class="oferta-fornecedor">${o.fornecedor}</span>
              <span class="oferta-cidade">${o.cidade}</span>
            </div>
            <span class="oferta-preco">R$ ${Number(o.preco).toFixed(2)}</span>
          </div>
        `
          )
          .join("")}
      </div>
    `
    )
    .join("");

  // Preenche os filtros de categoria apenas na primeira carga
  if (!categoria) {
    const categorias = [...new Set(insumos.map((i) => i.categoria))];
    const filtro = document.getElementById("insumosFiltro");
    filtro.innerHTML =
      '<button class="chip is-active" data-categoria="">Todos</button>' +
      categorias
        .map((c) => `<button class="chip" data-categoria="${c}">${formatarFase(c)}</button>`)
        .join("");

    filtro.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        filtro.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        carregarInsumos(chip.dataset.categoria);
        alternarInsightCompra(chip.dataset.categoria);
      });
    });
  }
}

async function carregarMinhasOfertas() {
  const lista = document.getElementById("minhasOfertasLista");
  if (!lista) return;
  const resp = await apiFetch("/insumos/meus");
  if (!resp.ok) {
    lista.innerHTML = '<p class="empty-state">Não foi possível carregar suas ofertas.</p>';
    return;
  }
  const ofertas = await resp.json();
  if (!ofertas.length) {
    lista.innerHTML = '<p class="empty-state">Você ainda não cadastrou ofertas. Clique em “+ Nova oferta”.</p>';
    return;
  }
  lista.innerHTML = ofertas
    .map(
      (o) =>
        `<div class="oferta-propria">` +
        `<div><strong>${o.nome}</strong><div class="oferta-cidade">${formatarFase(o.categoria)} · ${o.cidade}</div></div>` +
        `<span class="oferta-preco">${formatarMoeda(Number(o.preco))}</span>` +
        `<button type="button" class="btn btn-ghost" data-oferta="${o.id}">Remover</button>` +
        `</div>`
    )
    .join("");
  lista.querySelectorAll("[data-oferta]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remover esta oferta?")) return;
      await apiFetch("/insumos/" + btn.dataset.oferta, { method: "DELETE" });
      carregarMinhasOfertas();
      carregarInsumos();
    });
  });
}

const modalOferta = document.getElementById("modalOferta");
document.getElementById("btnNovaOferta").addEventListener("click", async () => {
  const select = document.getElementById("ofertaCatalogo");
  if (select.options.length <= 1) {
    const resp = await fetch(API_BASE + "/insumos");
    const insumos = await resp.json();
    insumos.forEach((i) => {
      const opt = document.createElement("option");
      opt.value = i.id;
      opt.textContent = i.nome + " (" + i.unidade + ")";
      opt.dataset.categoria = i.categoria;
      opt.dataset.unidade = i.unidade;
      opt.dataset.nome = i.nome;
      select.appendChild(opt);
    });
  }
  if (state.usuario?.cidade) document.querySelector('#formOferta [name="cidade"]').value = state.usuario.cidade;
  if (state.usuario?.telefone) document.querySelector('#formOferta [name="telefone"]').value = state.usuario.telefone || "";
  document.getElementById("ofertaErro").textContent = "";
  modalOferta.classList.add("is-open");
});
document.getElementById("ofertaCatalogo").addEventListener("change", (e) => {
  const opt = e.target.selectedOptions[0];
  if (!opt || !opt.value) return;
  document.getElementById("ofertaNome").value = opt.dataset.nome || "";
  document.getElementById("ofertaCategoria").value = opt.dataset.categoria || "";
  document.getElementById("ofertaUnidade").value = opt.dataset.unidade || "";
});
function fecharModalOferta() {
  modalOferta.classList.remove("is-open");
  document.getElementById("formOferta").reset();
}
document.getElementById("btnFecharOferta").addEventListener("click", fecharModalOferta);
document.getElementById("btnCancelarOferta").addEventListener("click", fecharModalOferta);
document.getElementById("formOferta").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(e.target).entries());
  const erroEl = document.getElementById("ofertaErro");
  erroEl.textContent = "";
  const resp = await apiFetch("/insumos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    erroEl.textContent = corpo.erro || "Não foi possível publicar a oferta.";
    return;
  }
  fecharModalOferta();
  carregarMinhasOfertas();
  carregarInsumos();
});

async function alternarInsightCompra(categoria) {
  const card = document.getElementById("insightCompraCard");

  if (!categoria) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  document.getElementById("insightCategoriaNome").textContent = formatarFase(categoria);
  document.getElementById("insightFonte").textContent = "—";
  document.getElementById("insightTexto").textContent = "Gerando recomendação de compra…";
  document.getElementById("insightFontesLista").innerHTML = "";

  try {
    const resp = await fetch(API_BASE + "/insumos/analise/" + categoria);
    const dados = await resp.json();

    if (!resp.ok) throw new Error(dados.erro || "Erro ao gerar recomendação");

    document.getElementById("insightTexto").textContent = dados.recomendacao;
    document.getElementById("insightFonte").textContent = rotuloGeracaoIA(dados.gerarPor);
    document.getElementById("insightFontesLista").innerHTML = renderizarFontes(dados.fontes);
  } catch (erro) {
    document.getElementById("insightTexto").textContent = "Não foi possível gerar a recomendação agora.";
  }
}

// ---------- MERCADO ----------

document.getElementById("mercadoTabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented-item");
  if (!btn) return;

  document.querySelectorAll("#mercadoTabs .segmented-item").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");

  state.culturaMercadoAtual = btn.dataset.cultura;
  carregarMercado(state.culturaMercadoAtual);
});

document.getElementById("visaoMercado").addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented-item");
  if (!btn) return;
  document.querySelectorAll("#visaoMercado .segmented-item").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");
  state.mercadoVisao = btn.dataset.visao;
  renderizarGrafico();
});

document.getElementById("periodoFiltros").addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented-item");
  if (!btn) return;

  document.querySelectorAll("#periodoFiltros .segmented-item").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");

  state.mercadoPeriodoAtual = btn.dataset.periodo;
  if (state.mercadoAnoAtual === "todos" && btn.dataset.periodo !== "ano") {
    state.mercadoAnoAtual = state.anoHistoricoFim || 2026;
    document.getElementById("anoSelect").value = String(state.mercadoAnoAtual);
  }
  renderizarGrafico();
});

document.getElementById("anoSelect").addEventListener("change", (e) => {
  state.mercadoAnoAtual = e.target.value === "todos" ? "todos" : Number(e.target.value);
  renderizarGrafico();
});

document.getElementById("btnRegerarAnalise").addEventListener("click", () => {
  carregarAnalise(state.culturaMercadoAtual);
});

function ehAnoProjecao(ano) {
  const n = Number(ano);
  const lista = state.anosProjecao?.length ? state.anosProjecao : [state.anoProjecao, state.anoProjecaoFim];
  return lista.map(Number).includes(n);
}

function popularAnoSelect() {
  const select = document.getElementById("anoSelect");
  if (!select) return;

  const fim = state.anoProjecaoFim || ANO_PROJECAO_FIM;
  const anos =
    state.mercadoAnosDisponiveis?.length > 0
      ? state.mercadoAnosDisponiveis
      : Array.from({ length: fim - ANO_INICIO + 1 }, (_, i) => String(fim - i));

  select.innerHTML =
    `<option value="todos">2010–${fim} (visão geral)</option>` +
    anos
      .map((a) => {
        const rotulo = ehAnoProjecao(a) ? a + " (projeção)" : a;
        return `<option value="${a}">${rotulo}</option>`;
      })
      .join("");

  const atual = String(state.mercadoAnoAtual);
  if (atual !== "todos" && !anos.includes(atual)) {
    state.mercadoAnoAtual = "todos";
  }
  select.value = String(state.mercadoAnoAtual);
  select.disabled = false;
}

popularAnoSelect();

async function carregarMercado(cultura) {
  state.mercadoCarregado = true;
  await Promise.all([carregarHistorico(cultura), carregarAnalise(cultura), carregarProjecao(cultura)]);
}

async function carregarHistorico(cultura) {
  try {
    const resp = await fetch(API_BASE + "/mercado/" + cultura + "/historico");
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.erro || "Falha ao carregar histórico");

    state.mercadoBrasilCompleto = (dados.mercadoInterno && dados.mercadoInterno.historico) || dados.historico || [];
    state.mercadoHistoricoAnual = dados.historicoAnual || [];
    state.mercadoProjecaoMensal = dados.projecaoMensal || [...(dados.projecao2027 || []), ...(dados.projecao2028 || [])];
    state.mercadoProjecaoPorAno = dados.projecaoPorAno || {
      2027: dados.projecao2027 || [],
      2028: dados.projecao2028 || [],
    };
    state.mercadoInternacionalCompleto = (dados.paridade && dados.paridade.historico) || [];
    state.mercadoAnosDisponiveis = dados.anosDisponiveis || [];
    state.anosProjecao = dados.anosProjecao || [dados.anoProjecao || ANO_PROJECAO, dados.anoProjecaoFim || ANO_PROJECAO_FIM];
    state.anoProjecao = dados.anoProjecao || ANO_PROJECAO;
    state.anoProjecaoFim = dados.anoProjecaoFim || ANO_PROJECAO_FIM;
    state.anoHistoricoFim = dados.anoHistoricoFim || 2026;
    state.mercadoUnidade = (dados.paridade && dados.paridade.unidade) || dados.unidade;
    popularAnoSelect();
    renderizarCotasMercado(dados);
    renderizarGrafico();
  } catch (erro) {
    console.error("[mercado] histórico:", erro);
    state.mercadoBrasilCompleto = [];
    const vazio = document.getElementById("chartVazio");
    const canvas = document.getElementById("chartMercado");
    if (canvas) canvas.hidden = true;
    if (vazio) {
      vazio.hidden = false;
      vazio.textContent = "Não foi possível carregar o histórico de preços.";
    }
  }
}

function renderizarCotasMercado(dados) {
  const box = document.getElementById("cotacoesMercado");
  const cards = [];
  const interno = dados.mercadoInterno || dados;
  const ultimoBr = interno.historico && interno.historico[interno.historico.length - 1];
  cards.push(
    `<div class="quote-card"><div class="quote-kicker">Brasil</div>` +
      `<div class="quote-value">${ultimoBr ? formatarMoeda(ultimoBr.preco) : "—"}</div>` +
      `<div class="quote-meta">${interno.unidade || dados.unidade} · referência interna</div></div>`
  );
  if (dados.internacional) {
    cards.push(
      `<div class="quote-card"><div class="quote-kicker">Internacional · ${dados.internacional.bolsa || ""}</div>` +
        `<div class="quote-value">${dados.internacional.preco} ${dados.internacional.unidade}</div>` +
        `<div class="quote-meta">${dados.internacional.ticker} · ${dados.internacional.data}</div></div>`
    );
  }
  if (dados.paridade) {
    cards.push(
      `<div class="quote-card"><div class="quote-kicker">Paridade em reais</div>` +
        `<div class="quote-value">${formatarMoeda(dados.paridade.preco)}</div>` +
        `<div class="quote-meta">${dados.paridade.unidade} · contrato × PTAX</div></div>`
    );
  }
  if (dados.dolarPtax) {
    cards.push(
      `<div class="quote-card"><div class="quote-kicker">Dólar PTAX</div>` +
        `<div class="quote-value">R$ ${Number(dados.dolarPtax.valor).toFixed(2)}</div>` +
        `<div class="quote-meta">${dados.dolarPtax.data}</div></div>`
    );
  }
  box.innerHTML = cards.join("");
}

async function carregarProjecao(cultura) {
  document.getElementById("projecaoTexto").textContent = "Carregando projeção mensal 2027–2028…";
  document.getElementById("projecaoPontos").innerHTML = "";

  try {
    const resp = await fetch(API_BASE + "/mercado/" + cultura + "/projecao");
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.erro || "Falha na projeção");

    state.mercadoProjecao = dados;
    state.mercadoProjecaoMensal = dados.pontosMensais || [];
    state.mercadoProjecaoPorAno = dados.pontosPorAno || {};
    if (!Object.keys(state.mercadoProjecaoPorAno).length && state.mercadoProjecaoMensal.length) {
      state.mercadoProjecaoPorAno = {};
      state.mercadoProjecaoMensal.forEach((p) => {
        const a = p.ano || Number(String(p.data).slice(0, 4));
        if (!state.mercadoProjecaoPorAno[a]) state.mercadoProjecaoPorAno[a] = [];
        state.mercadoProjecaoPorAno[a].push(p);
      });
    }
    if (dados.historicoAnual) state.mercadoHistoricoAnual = dados.historicoAnual;
    if (dados.anosProjecao) state.anosProjecao = dados.anosProjecao;
    if (dados.anoProjecaoFim) state.anoProjecaoFim = dados.anoProjecaoFim;

    document.getElementById("projecaoTexto").textContent = dados.resumo;

    const linhas = [];
    (dados.pontosAnuais || (dados.pontoAnual ? [dados.pontoAnual] : [])).forEach((pa) => {
      linhas.push(
        `<div class="projecao-ponto projecao-ponto-destaque">` +
          `<span class="projecao-horizonte">${pa.horizonteRotulo || pa.ano + " (média anual)"}</span>` +
          `<span class="projecao-preco">${formatarMoeda(pa.preco)}</span>` +
          `<span class="projecao-data">cenário</span>` +
        `</div>`
      );
    });

    const anos = dados.anosProjecao || Object.keys(state.mercadoProjecaoPorAno).map(Number).sort();
    anos.forEach((ano) => {
      const meses = state.mercadoProjecaoPorAno[ano] || [];
      if (!meses.length) return;
      linhas.push(`<div class="projecao-ano-titulo">${ano} · mensal</div>`);
      meses.forEach((p) => {
        linhas.push(
          `<div class="projecao-ponto">` +
            `<span class="projecao-horizonte">${p.horizonteRotulo || formatarHorizonteProjecao(p)}</span>` +
            `<span class="projecao-preco">${formatarMoeda(p.preco)}</span>` +
            `<span class="projecao-data">${formatarData(p.data)}</span>` +
          `</div>`
        );
      });
    });

    document.getElementById("projecaoPontos").innerHTML = linhas.join("");
    popularAnoSelect();
    renderizarGrafico();
  } catch (erro) {
    state.mercadoProjecao = null;
    document.getElementById("projecaoTexto").textContent = "Não foi possível carregar a projeção agora.";
    document.getElementById("projecaoPontos").innerHTML = "";
  }
}

function formatarHorizonteProjecao(p) {
  if (p.horizonteRotulo) return p.horizonteRotulo;
  if (p.horizonteMeses >= 12 && p.horizonteMeses % 12 === 0) {
    const anos = p.horizonteMeses / 12;
    return anos === 1 ? "1 ano" : anos + " anos";
  }
  if (p.horizonteDias) return p.horizonteDias + " dias";
  return (p.horizonteMeses || "?") + " meses";
}

async function carregarAnalise(cultura) {
  document.getElementById("analiseTexto").textContent = "Pesquisando cenário atual e gerando análise…";
  document.getElementById("analiseFatores").innerHTML = "";
  document.getElementById("analiseFontesLinks").innerHTML = "";
  document.getElementById("analiseFonte").textContent = "—";
  document.getElementById("analiseTendencia").textContent = "—";
  document.getElementById("analiseTendencia").className = "trend-figure";
  document.getElementById("analiseAvisoSimulado").hidden = true;

  try {
    const resp = await fetch(API_BASE + "/mercado/" + cultura + "/analise");
    const dados = await resp.json();

    const elTendencia = document.getElementById("analiseTendencia");
    elTendencia.textContent = formatarPercentual(dados.variacaoPercentual);
    elTendencia.classList.add(dados.variacaoPercentual >= 0 ? "up" : "down");

    document.getElementById("analiseTexto").textContent = dados.resumo;
    document.getElementById("analiseFonte").textContent = rotuloGeracaoIA(dados.gerarPor);
    document.getElementById("analiseAvisoSimulado").hidden = dados.gerarPor !== "simulado";

    document.getElementById("analiseFatores").innerHTML = dados.fatoresConsiderados
      .map((f) => `<div class="factor-item">${f}</div>`)
      .join("");

    document.getElementById("analiseFontesLinks").innerHTML = renderizarFontes(dados.fontes);
  } catch (erro) {
    document.getElementById("analiseTexto").textContent = "Não foi possível gerar a análise agora.";
  }
}

function formatarPercentual(valor) {
  const sinal = valor > 0 ? "+" : "";
  return sinal + valor.toFixed(1).replace(".", ",") + "%";
}

function renderizarFontes(fontes) {
  if (!fontes || fontes.length === 0) return "";
  return (
    '<div class="fontes-titulo">Fontes consultadas</div>' +
    fontes
      .map(
        (f) =>
          `<a class="fonte-link" href="${f.url}" target="_blank" rel="noopener noreferrer">${f.titulo}</a>`
      )
      .join("")
  );
}


function paraTimestamp(iso) {
  return new Date(iso + "T00:00:00Z").getTime();
}

function paraISO(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function filtrarHistorico(historico, periodo, ano) {
  if (!historico || historico.length === 0) return [];

  const anoStr = String(ano);

  if (anoStr === "todos") return [];

  if (ehAnoProjecao(ano)) {
    const porAno = state.mercadoProjecaoPorAno || {};
    return porAno[Number(ano)] || (state.mercadoProjecaoMensal || []).filter((p) => String(p.data).startsWith(anoStr + "-"));
  }

  const doAno = historico.filter((p) => p.data.startsWith(anoStr + "-") && p.tipo !== "projecao");
  if (doAno.length === 0) return [];

  if (periodo === "ano") return doAno;

  const ultimoPonto = doAno[doAno.length - 1];
  const corte = new Date(paraTimestamp(ultimoPonto.data));
  if (periodo === "7") corte.setUTCDate(corte.getUTCDate() - 7);
  else if (periodo === "mes") corte.setUTCMonth(corte.getUTCMonth() - 1);
  else if (periodo === "6meses") corte.setUTCMonth(corte.getUTCMonth() - 6);

  const corteTs = corte.getTime();
  return doAno.filter((p) => paraTimestamp(p.data) >= corteTs);
}

let mercadoChart = null;

function serieGrafico(historico, label, cor, fill) {
  const filtrado = filtrarHistorico(historico || [], state.mercadoPeriodoAtual, state.mercadoAnoAtual);
  return {
    filtrado,
    dataset: {
      label,
      data: filtrado.map((p) => ({ x: paraTimestamp(p.data), y: p.preco })),
      borderColor: cor,
      backgroundColor: fill,
      fill: Boolean(fill),
      tension: 0.15,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
    },
  };
}

function agregarAnualCliente(historico) {
  const porAno = {};
  for (const p of historico || []) {
    if (p.tipo === "projecao") continue;
    const ano = p.data.slice(0, 4);
    if (!porAno[ano]) porAno[ano] = [];
    porAno[ano].push(p.preco);
  }
  return Object.entries(porAno)
    .map(([ano, precos]) => ({
      ano: Number(ano),
      data: ano + "-12-15",
      preco: Number((precos.reduce((a, b) => a + b, 0) / precos.length).toFixed(2)),
      tipo: "historico",
    }))
    .sort((a, b) => a.ano - b.ano);
}

function serieGraficoAnual() {
  let anualCompleto = state.mercadoHistoricoAnual || [];
  if (anualCompleto.length === 0 && state.mercadoBrasilCompleto?.length) {
    anualCompleto = agregarAnualCliente(state.mercadoBrasilCompleto);
    const extras = state.mercadoProjecao?.pontosAnuais || (state.mercadoProjecao?.pontoAnual ? [state.mercadoProjecao.pontoAnual] : []);
    anualCompleto = anualCompleto.concat(extras);
  }

  const hist = anualCompleto.filter((p) => p.tipo !== "projecao");
  const proj = anualCompleto.filter((p) => p.tipo === "projecao");
  const ultimo = hist[hist.length - 1];
  const fimHist = state.anoHistoricoFim || 2026;
  const fimProj = state.anoProjecaoFim || ANO_PROJECAO_FIM;

  const datasets = [
    {
      label: "Histórico " + ANO_INICIO + "–" + fimHist,
      data: hist.map((p) => ({ x: Number(p.ano || p.data.slice(0, 4)), y: p.preco })),
      borderColor: "#4C7A4F",
      backgroundColor: "rgba(76, 122, 79, 0.08)",
      fill: true,
      tension: 0.2,
      borderWidth: 2.5,
      pointRadius: 3,
      pointHoverRadius: 5,
    },
  ];

  if (ultimo && proj.length) {
    datasets.push({
      label: "Projeção " + (state.anosProjecao || [ANO_PROJECAO, fimProj]).join("–"),
      data: [
        { x: Number(ultimo.ano || ultimo.data.slice(0, 4)), y: ultimo.preco },
        ...proj.map((p) => ({ x: Number(p.ano || p.data.slice(0, 4)), y: p.preco })),
      ],
      borderColor: "#9B8B6E",
      backgroundColor: "transparent",
      borderDash: [6, 4],
      tension: 0.2,
      borderWidth: 2,
      pointRadius: 6,
      pointHoverRadius: 7,
      pointBackgroundColor: "#9B8B6E",
      fill: false,
    });
  }

  return { datasets, hist, proj, ultimo };
}

function renderizarGrafico() {
  const canvas = document.getElementById("chartMercado");
  const vazio = document.getElementById("chartVazio");
  const meta = document.getElementById("chartMeta");

  if (!state.mercadoBrasilCompleto || state.mercadoBrasilCompleto.length === 0) {
    if (mercadoChart) {
      mercadoChart.destroy();
      mercadoChart = null;
    }
    canvas.hidden = true;
    vazio.hidden = false;
    vazio.textContent = "Carregando histórico de preços…";
    meta.innerHTML = "";
    return;
  }

  const visao = state.mercadoVisao;
  const visaoGeral = state.mercadoAnoAtual === "todos";
  let datasets = [];
  let metaPrimeiro = null;
  let metaUltimo = null;
  let eixoAnual = false;

  // Visão geral 2010–2028: o seletor de ano controla isso (valor "todos")
  if (visaoGeral) {
    const anual = serieGraficoAnual();
    datasets = anual.datasets;
    metaPrimeiro = anual.hist[0] || null;
    metaUltimo = (anual.proj && anual.proj[anual.proj.length - 1]) || anual.ultimo || null;
    eixoAnual = true;
  } else {
    const series = [];
    const verProjecao = ehAnoProjecao(state.mercadoAnoAtual);

    if (visao === "brasil" || visao === "comparar") {
      if (verProjecao) {
        const pts =
          (state.mercadoProjecaoPorAno && state.mercadoProjecaoPorAno[Number(state.mercadoAnoAtual)]) ||
          (state.mercadoProjecaoMensal || []).filter((p) => String(p.data).startsWith(String(state.mercadoAnoAtual) + "-"));
        if (pts.length) {
          series.push({
            filtrado: pts,
            dataset: {
              label: "Projeção " + state.mercadoAnoAtual + " (mensal)",
              data: pts.map((p) => ({ x: paraTimestamp(p.data), y: p.preco })),
              borderColor: "#9B8B6E",
              backgroundColor: "transparent",
              borderDash: [6, 4],
              tension: 0.2,
              borderWidth: 2,
              pointRadius: 3,
              pointHoverRadius: 5,
              fill: false,
            },
          });
        }
      } else {
        const br = serieGrafico(state.mercadoBrasilCompleto, "Brasil (interno · mensal)", "#4C7A4F", "rgba(76, 122, 79, 0.08)");
        if (br.filtrado.length) series.push(br);
      }
    }

    if (!verProjecao && (visao === "internacional" || visao === "comparar") && state.mercadoInternacionalCompleto.length) {
      const intl = serieGrafico(
        state.mercadoInternacionalCompleto,
        "Paridade internacional",
        "#6B3F2A",
        visao === "internacional" ? "rgba(107, 63, 42, 0.08)" : null
      );
      if (intl.filtrado.length) series.push(intl);
    }

    datasets = series.map((s) => s.dataset);
    const usada = series.find((s) => s.filtrado.length);
    if (usada) {
      metaPrimeiro = usada.filtrado[0];
      metaUltimo = usada.filtrado[usada.filtrado.length - 1];
    }
  }

  const alguma = datasets.some((d) => d.data && d.data.length > 0);
  if (!alguma) {
    if (mercadoChart) {
      mercadoChart.destroy();
      mercadoChart = null;
    }
    canvas.hidden = true;
    vazio.hidden = false;
    vazio.textContent = "Sem dados para este ano e período.";
    meta.innerHTML = "";
    return;
  }

  canvas.hidden = false;
  vazio.hidden = true;
  if (mercadoChart) {
    mercadoChart.destroy();
    mercadoChart = null;
  }

  const ticksLimit = eixoAnual ? 18 : 8;

  try {
    mercadoChart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            type: "linear",
            bounds: "data",
            grid: { display: false },
            ticks: {
              color: "#4A4438",
              font: { family: "IBM Plex Mono", size: 11 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: ticksLimit,
              callback: (valor) =>
                eixoAnual ? String(Math.round(valor)) : formatarDataEixo(valor, state.mercadoPeriodoAtual),
            },
          },
          y: {
            grid: { color: "#E2DCC9" },
            ticks: { color: "#4A4438", font: { family: "IBM Plex Mono", size: 11 } },
          },
        },
        plugins: {
          legend: { display: datasets.length > 1, position: "top", labels: { boxWidth: 12, font: { family: "IBM Plex Sans", size: 12 } } },
          tooltip: {
            backgroundColor: "#26221D",
            padding: 10,
            titleFont: { family: "IBM Plex Mono", size: 11 },
            bodyFont: { family: "IBM Plex Sans", size: 12.5 },
            callbacks: {
              title: (items) => {
                if (eixoAnual) return "Ano " + Math.round(items[0].parsed.x);
                return formatarData(paraISO(items[0].parsed.x));
              },
              label: (item) => item.dataset.label + ": R$ " + item.parsed.y.toFixed(2),
            },
          },
        },
      },
    });
  } catch (erro) {
    console.error("[mercado] Chart.js:", erro);
    canvas.hidden = true;
    vazio.hidden = false;
    vazio.textContent = "Erro ao desenhar o gráfico. Recarregue a página.";
    return;
  }

  if (metaPrimeiro && metaUltimo) {
    const rotuloUltimo =
      metaUltimo.tipo === "projecao" || ehAnoProjecao(metaUltimo.ano || String(metaUltimo.data || "").slice(0, 4))
        ? " (projeção)"
        : "";
    const inicio = eixoAnual
      ? (metaPrimeiro.ano || metaPrimeiro.data.slice(0, 4)) + " · " + formatarMoeda(metaPrimeiro.preco)
      : formatarData(metaPrimeiro.data) + " · " + formatarMoeda(metaPrimeiro.preco);
    const fim = eixoAnual
      ? (metaUltimo.ano || metaUltimo.data.slice(0, 4)) + " · " + formatarMoeda(metaUltimo.preco) + rotuloUltimo
      : formatarData(metaUltimo.data) + " · " + formatarMoeda(metaUltimo.preco) + rotuloUltimo;
    meta.innerHTML = `<span>${inicio}</span><span>${fim} (${state.mercadoUnidade})</span>`;
  } else {
    meta.innerHTML = "";
  }
}

function formatarData(iso) {
  const [ano, mes, dia] = iso.split("-");
  return dia + "/" + mes;
}

function formatarDataEixo(timestamp, periodo) {
  const iso = paraISO(timestamp);
  const [ano, mes, dia] = iso.split("-");
  if (periodo === "tudo") return ano;
  if (periodo === "5anos" || periodo === "2anos") return mes + "/" + ano.slice(2);
  return dia + "/" + mes;
}

// ---------- SIMULADOR (venda x insumos) ----------

const simState = {
  precoAtual: 0,
  unidade: "",
  insumos: null,
};

const modalSimulador = document.getElementById("modalSimulador");

document.getElementById("btnSimulador").addEventListener("click", abrirSimulador);
document.getElementById("btnFecharSimulador").addEventListener("click", fecharSimulador);
modalSimulador.addEventListener("click", (e) => {
  if (e.target === modalSimulador) fecharSimulador();
});

document.getElementById("simuladorTabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented-item");
  if (!btn) return;

  document.querySelectorAll("#simuladorTabs .segmented-item").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");

  const aba = btn.dataset.simtab;
  document.getElementById("painelVenda").hidden = aba !== "venda";
  document.getElementById("painelInsumos").hidden = aba !== "insumos";
});

document.getElementById("simCultura").addEventListener("change", () => carregarPrecoSimulador());
document.getElementById("simQuantidade").addEventListener("input", recalcularSimulador);

async function abrirSimulador() {
  document.getElementById("simCultura").value = state.culturaMercadoAtual;
  modalSimulador.classList.add("is-open");

  const tarefas = [carregarPrecoSimulador()];
  if (!simState.insumos) tarefas.push(carregarInsumosSimulador());
  await Promise.all(tarefas);
}

function fecharSimulador() {
  modalSimulador.classList.remove("is-open");
}

async function carregarPrecoSimulador() {
  const cultura = document.getElementById("simCultura").value;
  document.getElementById("simPrecoInfo").textContent = "Buscando preço atual…";

  const resp = await fetch(API_BASE + "/mercado/" + cultura + "/historico");
  const dados = await resp.json();
  const ultimo = dados.historico[dados.historico.length - 1];

  simState.precoAtual = ultimo.preco;
  simState.unidade = dados.unidade;

  document.getElementById("simQuantidadeLabel").textContent = "Quantidade a vender (" + dados.unidade + ")";
  document.getElementById("simPrecoInfo").textContent =
    "Preço interno Brasil: " + formatarMoeda(ultimo.preco) + " por " + dados.unidade + " (" + formatarData(ultimo.data) + ")";

  recalcularSimulador();
}

async function carregarInsumosSimulador() {
  const resp = await fetch(API_BASE + "/insumos");
  simState.insumos = await resp.json();
  renderizarListaInsumosSimulador();
}

function renderizarListaInsumosSimulador() {
  const lista = document.getElementById("simInsumosLista");
  lista.innerHTML = simState.insumos
    .map(
      (i) => `
    <div class="sim-insumo-row">
      <div class="sim-insumo-nome">
        ${i.nome}
        <span class="sim-insumo-unidade">melhor preço encontrado: ${formatarMoeda(i.melhorPreco.preco)} / ${i.unidade} (${i.melhorPreco.fornecedor})</span>
      </div>
      <div class="sim-insumo-inputs">
        <label class="sim-insumo-campo">
          <span>Preço (${i.unidade})</span>
          <input type="number" class="sim-insumo-preco" min="0" step="0.01" value="${i.melhorPreco.preco}" />
        </label>
        <label class="sim-insumo-campo">
          <span>Quantidade</span>
          <input type="number" class="sim-insumo-qtd" min="0" step="1" value="0" />
        </label>
      </div>
    </div>`
    )
    .join("");

  lista.querySelectorAll(".sim-insumo-preco, .sim-insumo-qtd").forEach((input) => {
    input.addEventListener("input", recalcularSimulador);
  });
}

function recalcularSimulador() {
  const cultura = document.getElementById("simCultura").value;
  const quantidade = Number(document.getElementById("simQuantidade").value) || 0;
  const receita = quantidade * simState.precoAtual;

  document.getElementById("simReceitaDestaque").textContent = formatarMoeda(receita);
  document.getElementById("simVendaResumo").textContent =
    "Vendendo " + quantidade + " " + simState.unidade + " de " + (NOMES_CULTURA[cultura] || cultura).toLowerCase() +
    " ao preço atual (" + formatarMoeda(simState.precoAtual) + "), você receberia aproximadamente " +
    formatarMoeda(receita) + ".";

  let custoInsumos = 0;
  document.querySelectorAll(".sim-insumo-row").forEach((row) => {
    const preco = Number(row.querySelector(".sim-insumo-preco").value) || 0;
    const qtd = Number(row.querySelector(".sim-insumo-qtd").value) || 0;
    custoInsumos += preco * qtd;
  });

  const margem = receita - custoInsumos;
  document.getElementById("simMargemReceita").textContent = formatarMoeda(receita);
  document.getElementById("simMargemCusto").textContent = "- " + formatarMoeda(custoInsumos);

  const elMargem = document.getElementById("simMargemTotal");
  elMargem.textContent = formatarMoeda(margem);
  elMargem.className = "trend-figure " + (margem >= 0 ? "up" : "down");
}

function formatarMoeda(valor) {
  return "R$ " + valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- MAPAS (Leaflet) ----------

const CENTRO_SUL_MINAS = [-21.5, -45.7];
const COR_CULTURA = {
  cafe: "#6B3F2A",
  soja: "#4C7A4F",
  milho: "#C9A227",
  cana: "#7CB342",
  feijao: "#8D6E63",
};

const mapaState = { mapa: null, camadas: [] };

const cadastroMapaState = {
  mapa: null,
  marcador: null,
  vertices: [],
  vertexMarkers: [],
  poligono: null,
  poligonoLayer: null,
  polylineLayer: null,
  modoDelimitar: false,
};

function criarTileLayer() {
  return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
}

function parsePoligono(poligono) {
  if (!poligono) return null;
  if (typeof poligono === "string") {
    try {
      return JSON.parse(poligono);
    } catch (erro) {
      return null;
    }
  }
  return Array.isArray(poligono) ? poligono : null;
}

function montarDatasetProjecao(visao) {
  if (visao === "internacional" || !state.mercadoProjecao?.pontos?.length || !state.mercadoBrasilCompleto?.length) {
    return null;
  }
  const ultimo = state.mercadoBrasilCompleto[state.mercadoBrasilCompleto.length - 1];
  const pontos = [
    { x: paraTimestamp(ultimo.data), y: ultimo.preco },
    ...state.mercadoProjecao.pontos.map((p) => ({ x: paraTimestamp(p.data), y: p.preco })),
  ];
  return {
    label: "Projeção futura",
    data: pontos,
    borderColor: "#9B8B6E",
    backgroundColor: "transparent",
    borderDash: [6, 4],
    tension: 0.1,
    borderWidth: 2,
    pointRadius: 4,
    pointHoverRadius: 5,
    pointBackgroundColor: "#9B8B6E",
  };
}

function inicializarMapaTalhoes() {
  if (mapaState.mapa) return;

  const fallback = document.getElementById("mapaFallback");
  if (typeof L === "undefined") {
    fallback.hidden = false;
    fallback.textContent = "Não foi possível carregar o mapa. Verifique sua conexão e recarregue a página.";
    return;
  }

  const el = document.getElementById("mapaTalhoes");
  mapaState.mapa = L.map(el, { zoomControl: true }).setView(CENTRO_SUL_MINAS, 8);
  criarTileLayer().addTo(mapaState.mapa);
  fallback.hidden = true;
  atualizarMarcadoresMapa();
}

function garantirMapaTalhoes() {
  if (!mapaState.mapa) inicializarMapaTalhoes();
  else mapaState.mapa.invalidateSize();
  atualizarMarcadoresMapa();
}

function limparCamadasMapa() {
  mapaState.camadas.forEach((c) => mapaState.mapa.removeLayer(c));
  mapaState.camadas = [];
}

function atualizarMarcadoresMapa() {
  if (!mapaState.mapa) return;

  limparCamadasMapa();
  const bounds = L.latLngBounds();

  state.talhoes.forEach((talhao) => {
    const cor = COR_CULTURA[talhao.cultura] || "#4C7A4F";
    const selecionado = talhao.id === state.talhaoSelecionadoId;
    const verts = parsePoligono(talhao.poligono);

    if (verts && verts.length >= 3) {
      const latlngs = verts.map((p) => [p.lat, p.lng]);
      const poly = L.polygon(latlngs, {
        color: cor,
        weight: selecionado ? 3 : 2,
        fillColor: cor,
        fillOpacity: selecionado ? 0.35 : 0.2,
      })
        .bindTooltip(talhao.nome)
        .on("click", () => selecionarTalhao(talhao.id));
      poly.addTo(mapaState.mapa);
      mapaState.camadas.push(poly);
      latlngs.forEach((ll) => bounds.extend(ll));
    } else {
      const marker = L.circleMarker([talhao.latitude, talhao.longitude], {
        radius: selecionado ? 9 : 7,
        color: cor,
        weight: 2,
        fillColor: cor,
        fillOpacity: 0.85,
      })
        .bindTooltip(talhao.nome)
        .on("click", () => selecionarTalhao(talhao.id));
      marker.addTo(mapaState.mapa);
      mapaState.camadas.push(marker);
      bounds.extend([talhao.latitude, talhao.longitude]);
    }
  });

  if (state.talhoes.length > 0 && bounds.isValid()) {
    mapaState.mapa.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
  }
}

function garantirMapaCadastro() {
  if (cadastroMapaState.mapa || typeof L === "undefined") return;

  const el = document.getElementById("mapaCadastro");
  cadastroMapaState.mapa = L.map(el, { zoomControl: true }).setView(CENTRO_SUL_MINAS, 10);
  criarTileLayer().addTo(cadastroMapaState.mapa);

  cadastroMapaState.mapa.on("click", (e) => {
    if (cadastroMapaState.modoDelimitar) {
      adicionarVerticeCadastro(e.latlng);
    } else {
      definirPontoCadastro(e.latlng);
    }
  });
}

function definirPontoCadastro(latlng, pularReverse = false) {
  limparVerticesCadastro();
  cadastroMapaState.poligono = null;

  if (cadastroMapaState.marcador) {
    cadastroMapaState.marcador.setLatLng(latlng);
  } else {
    cadastroMapaState.marcador = L.circleMarker(latlng, {
      radius: 8,
      color: "#4C7A4F",
      weight: 2,
      fillColor: "#4C7A4F",
      fillOpacity: 0.9,
    }).addTo(cadastroMapaState.mapa);
  }

  document.getElementById("talhaoLat").value = latlng.lat.toFixed(6);
  document.getElementById("talhaoLng").value = latlng.lng.toFixed(6);
  atualizarHintCadastro("Ponto marcado. Use “Delimitar área” para desenhar o polígono do talhão.");

  if (!pularReverse) preencherEnderecoDoPonto(latlng);
}

async function preencherEnderecoDoPonto(latlng) {
  try {
    const resp = await apiFetch(
      "/talhoes/geocodificar-reverso?lat=" + encodeURIComponent(latlng.lat) + "&lng=" + encodeURIComponent(latlng.lng)
    );
    const dados = await resp.json();
    if (!resp.ok) return;
    const input = document.getElementById("talhaoEndereco");
    if (dados.enderecoFormatado) {
      input.value = dados.enderecoFormatado;
      feedbackEndereco("Localizado: " + dados.enderecoFormatado);
    }
  } catch (erro) {
    // endereço opcional se o reverse falhar
  }
}

function distanciaMetros(a, b) {
  return cadastroMapaState.mapa.distance(a, b);
}

function adicionarVerticeCadastro(latlng) {
  if (cadastroMapaState.marcador) {
    cadastroMapaState.mapa.removeLayer(cadastroMapaState.marcador);
    cadastroMapaState.marcador = null;
  }

  const primeiro = cadastroMapaState.vertices[0];
  if (primeiro && cadastroMapaState.vertices.length >= 3 && distanciaMetros(latlng, primeiro) < 25) {
    fecharPoligonoCadastro();
    return;
  }

  cadastroMapaState.vertices.push(latlng);
  atualizarPreviewPoligonoCadastro();

  const btn = document.getElementById("btnDelimitar");
  if (cadastroMapaState.vertices.length >= 3) {
    btn.textContent = "Fechar polígono";
    atualizarHintCadastro("Clique no primeiro ponto (ou em “Fechar polígono”) para concluir a área.");
  } else {
    atualizarHintCadastro("Marque os cantos do talhão. Mínimo de 3 pontos.");
  }
}

function atualizarPreviewPoligonoCadastro() {
  if (cadastroMapaState.polylineLayer) {
    cadastroMapaState.mapa.removeLayer(cadastroMapaState.polylineLayer);
  }
  (cadastroMapaState.vertexMarkers || []).forEach((m) => cadastroMapaState.mapa.removeLayer(m));
  cadastroMapaState.vertexMarkers = cadastroMapaState.vertices.map((ll, i) =>
    L.circleMarker(ll, {
      radius: i === 0 ? 7 : 5,
      color: i === 0 ? "#C9A227" : "#4C7A4F",
      fillColor: i === 0 ? "#C9A227" : "#4C7A4F",
      fillOpacity: 1,
      weight: 2,
    }).addTo(cadastroMapaState.mapa)
  );
  if (cadastroMapaState.vertices.length >= 2) {
    cadastroMapaState.polylineLayer = L.polyline(cadastroMapaState.vertices, {
      color: "#4C7A4F",
      dashArray: "4 4",
    }).addTo(cadastroMapaState.mapa);
  }
}

function fecharPoligonoCadastro() {
  if (cadastroMapaState.vertices.length < 3) return;

  const verts = cadastroMapaState.vertices.map((ll) => ({ lat: ll.lat, lng: ll.lng }));
  cadastroMapaState.poligono = verts;

  if (cadastroMapaState.polylineLayer) {
    cadastroMapaState.mapa.removeLayer(cadastroMapaState.polylineLayer);
    cadastroMapaState.polylineLayer = null;
  }
  if (cadastroMapaState.poligonoLayer) {
    cadastroMapaState.mapa.removeLayer(cadastroMapaState.poligonoLayer);
  }

  cadastroMapaState.poligonoLayer = L.polygon(cadastroMapaState.vertices, {
    color: "#4C7A4F",
    weight: 2,
    fillColor: "#4C7A4F",
    fillOpacity: 0.25,
  }).addTo(cadastroMapaState.mapa);

  const centro = cadastroMapaState.poligonoLayer.getBounds().getCenter();
  document.getElementById("talhaoLat").value = centro.lat.toFixed(6);
  document.getElementById("talhaoLng").value = centro.lng.toFixed(6);
  preencherEnderecoDoPonto(centro);

  cadastroMapaState.modoDelimitar = false;
  document.getElementById("btnDelimitar").classList.remove("is-active");
  document.getElementById("btnDelimitar").textContent = "Delimitar área";
  atualizarHintCadastro("Área delimitada. Ajuste com “Limpar marca” se precisar refazer.");
}

function limparVerticesCadastro() {
  cadastroMapaState.vertices = [];
  (cadastroMapaState.vertexMarkers || []).forEach((m) => {
    if (cadastroMapaState.mapa) cadastroMapaState.mapa.removeLayer(m);
  });
  cadastroMapaState.vertexMarkers = [];
  if (cadastroMapaState.polylineLayer && cadastroMapaState.mapa) {
    cadastroMapaState.mapa.removeLayer(cadastroMapaState.polylineLayer);
    cadastroMapaState.polylineLayer = null;
  }
}

function limparCadastroMapa() {
  cadastroMapaState.modoDelimitar = false;
  cadastroMapaState.poligono = null;
  cadastroMapaState.vertices = [];
  document.getElementById("btnDelimitar").classList.remove("is-active");
  document.getElementById("btnDelimitar").textContent = "Delimitar área";
  document.getElementById("talhaoLat").value = "";
  document.getElementById("talhaoLng").value = "";
  atualizarHintCadastro('Informe o endereço e clique em “Localizar no mapa”. Depois ajuste o ponto ou delimite a área do talhão.');

  if (!cadastroMapaState.mapa) return;

  if (cadastroMapaState.marcador) {
    cadastroMapaState.mapa.removeLayer(cadastroMapaState.marcador);
    cadastroMapaState.marcador = null;
  }
  if (cadastroMapaState.poligonoLayer) {
    cadastroMapaState.mapa.removeLayer(cadastroMapaState.poligonoLayer);
    cadastroMapaState.poligonoLayer = null;
  }
  limparVerticesCadastro();
}

function atualizarHintCadastro(texto) {
  const el = document.getElementById("mapaCadastroHint");
  if (el) el.textContent = texto;
}

document.getElementById("btnDelimitar").addEventListener("click", () => {
  garantirMapaCadastro();

  if (cadastroMapaState.modoDelimitar && cadastroMapaState.vertices.length >= 3) {
    fecharPoligonoCadastro();
    return;
  }

  cadastroMapaState.modoDelimitar = !cadastroMapaState.modoDelimitar;
  const btn = document.getElementById("btnDelimitar");
  btn.classList.toggle("is-active", cadastroMapaState.modoDelimitar);

  if (cadastroMapaState.modoDelimitar) {
    btn.textContent = cadastroMapaState.vertices.length >= 3 ? "Fechar polígono" : "Delimitar área";
    limparVerticesCadastro();
    if (cadastroMapaState.poligonoLayer) {
      cadastroMapaState.mapa.removeLayer(cadastroMapaState.poligonoLayer);
      cadastroMapaState.poligonoLayer = null;
    }
    cadastroMapaState.poligono = null;
    atualizarHintCadastro("Modo delimitar: clique no mapa para cada canto do talhão.");
  } else {
    btn.textContent = "Delimitar área";
    limparVerticesCadastro();
    atualizarHintCadastro("Clique no mapa para marcar um ponto ou reative a delimitação.");
  }
});

document.getElementById("btnLimparMapa").addEventListener("click", () => {
  garantirMapaCadastro();
  limparCadastroMapa();
});

function iniciarApp() {
  carregarStatus();
  carregarPainel();
  if (papelAtual() === "produtor") {
    carregarTalhoes();
    carregarMensagens(true);
  }
}

if (restaurarSessao()) {
  mostrarApp();
} else {
  mostrarLogin();
}
