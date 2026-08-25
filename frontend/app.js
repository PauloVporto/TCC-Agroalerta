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

const state = {
  talhoes: [],
  talhaoSelecionadoId: null,
  culturaMercadoAtual: "cafe",
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

  iniciarApp();
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

document.getElementById("formRegistro").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(e.target).entries());
  const erroEl = document.getElementById("registroErro");
  erroEl.textContent = "";

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

  if (view === "configuracoes") carregarConfiguracoes();
  if (view === "insumos" && !state.insumosCarregados) carregarInsumos();
  if (view === "mercado" && !state.mercadoCarregado) carregarMercado(state.culturaMercadoAtual);
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
  const resp = await apiFetch("/auth/perfil", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados),
  });
  const corpo = await resp.json();
  if (!resp.ok) return feedbackConfiguracao("perfilFeedback", corpo.erro, true);
  state.usuario = corpo;
  sessionStorage.setItem("agroalerta_usuario", JSON.stringify(corpo));
  document.getElementById("userName").textContent = corpo.nome;
  document.getElementById("userAvatar").textContent = corpo.nome.charAt(0).toUpperCase();
  feedbackConfiguracao("perfilFeedback", "Perfil atualizado.");
});

document.getElementById("formPreferencias").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(e.target).entries());
  dados.notificacoes = e.target.notificacoes.checked;
  const resp = await apiFetch("/auth/preferencias", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados),
  });
  const corpo = await resp.json();
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
    definirPill("statusIA", dados.modoIA);
    definirPill("statusMapas", dados.modoMapas);
  } catch (erro) {
    console.error("Não foi possível conectar ao backend.", erro);
  }
}

function definirPill(id, modo) {
  const el = document.getElementById(id);
  el.textContent = modo === "real" ? "real" : "simulado";
  el.classList.toggle("real", modo === "real");
}

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
          ${t.cultura === "cafe" ? "Café" : "Soja"} · ${formatarFase(t.fase)}
        </div>
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

function renderizarDetalheTalhao(dados) {
  const { talhao, clima, alertas } = dados;
  const detalhe = document.getElementById("talhaoDetail");

  const alertasHtml =
    alertas.length === 0
      ? '<div class="sem-alertas">Nenhum risco identificado no momento para este talhão.</div>'
      : alertas
          .map(
            (a) => `
        <div class="alerta-item ${a.nivel}">
          <div class="alerta-top">
            <span class="alerta-titulo">${a.titulo}</span>
            <span class="nivel-tag ${a.nivel}">${a.nivel}</span>
          </div>
          <p class="alerta-msg">${a.mensagem}</p>
          <p class="alerta-rec">Recomendação: ${a.recomendacao}</p>
        </div>
      `
          )
          .join("");

  detalhe.innerHTML = `
    <div class="detail-header">
      <div>
        <div class="detail-title">${talhao.nome}</div>
      </div>
      <span class="crop-dot ${talhao.cultura}"></span>
    </div>
    <div class="detail-sub">${talhao.cultura === "cafe" ? "Café" : "Soja"} · ${formatarFase(talhao.fase)} · fonte do clima: ${clima.fonte}</div>

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
  `;
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
}

formTalhao.addEventListener("submit", async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(formTalhao).entries());

  const botao = formTalhao.querySelector('button[type="submit"]');
  botao.disabled = true;
  botao.textContent = "Cadastrando…";

  try {
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
    alert("Não foi possível cadastrar o talhão. Verifique se o backend está rodando.");
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
            <span class="oferta-preco">R$ ${o.preco.toFixed(2)}</span>
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
    document.getElementById("insightFonte").textContent =
      dados.gerarPor === "ia_com_busca" ? "IA + busca na web" : "modo simulado";
    document.getElementById("insightFontesLista").innerHTML = renderizarFontes(dados.fontes);
  } catch (erro) {
    document.getElementById("insightTexto").textContent = "Não foi possível gerar a recomendação agora.";
  }
}

// ---------- MERCADO ----------

document.getElementById("mercadoTabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented-item");
  if (!btn) return;

  document.querySelectorAll(".segmented-item").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");

  state.culturaMercadoAtual = btn.dataset.cultura;
  carregarMercado(state.culturaMercadoAtual);
});

document.getElementById("btnRegerarAnalise").addEventListener("click", () => {
  carregarAnalise(state.culturaMercadoAtual);
});

async function carregarMercado(cultura) {
  state.mercadoCarregado = true;
  await Promise.all([carregarHistorico(cultura), carregarAnalise(cultura)]);
}

async function carregarHistorico(cultura) {
  const resp = await fetch(API_BASE + "/mercado/" + cultura + "/historico");
  const dados = await resp.json();
  desenharGrafico(dados.historico, dados.unidade);
}

async function carregarAnalise(cultura) {
  document.getElementById("analiseTexto").textContent = "Pesquisando cenário atual e gerando análise…";
  document.getElementById("analiseFatores").innerHTML = "";
  document.getElementById("analiseFontesLinks").innerHTML = "";
  document.getElementById("analiseFonte").textContent = "—";

  try {
    const resp = await fetch(API_BASE + "/mercado/" + cultura + "/analise");
    const dados = await resp.json();

    document.getElementById("analiseTexto").textContent = dados.resumo;
    document.getElementById("analiseFonte").textContent =
      dados.gerarPor === "ia_com_busca" ? "IA + busca na web" : "modo simulado";

    document.getElementById("analiseFatores").innerHTML = dados.fatoresConsiderados
      .map((f) => `<div class="factor-item">${f}</div>`)
      .join("");

    document.getElementById("analiseFontesLinks").innerHTML = renderizarFontes(dados.fontes);
  } catch (erro) {
    document.getElementById("analiseTexto").textContent = "Não foi possível gerar a análise agora.";
  }
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


function desenharGrafico(historico, unidade) {
  const canvas = document.getElementById("chartMercado");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const padding = { top: 16, right: 16, bottom: 28, left: 56 };

  ctx.clearRect(0, 0, w, h);

  const precos = historico.map((p) => p.preco);
  const min = Math.min(...precos) * 0.98;
  const max = Math.max(...precos) * 1.02;

  const escalaX = (i) => padding.left + (i / (historico.length - 1)) * (w - padding.left - padding.right);
  const escalaY = (v) => h - padding.bottom - ((v - min) / (max - min)) * (h - padding.top - padding.bottom);

  // Grade horizontal
  ctx.strokeStyle = "#E2DCC9";
  ctx.lineWidth = 1;
  ctx.font = "11px IBM Plex Mono, monospace";
  ctx.fillStyle = "#6B6559";
  const passos = 4;
  for (let i = 0; i <= passos; i++) {
    const valor = min + ((max - min) / passos) * i;
    const y = escalaY(valor);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();
    ctx.fillText(valor.toFixed(0), 6, y + 4);
  }

  // Linha de preço
  ctx.beginPath();
  historico.forEach((ponto, i) => {
    const x = escalaX(i);
    const y = escalaY(ponto.preco);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#6B3F2A";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Área sob a linha
  ctx.lineTo(escalaX(historico.length - 1), h - padding.bottom);
  ctx.lineTo(escalaX(0), h - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = "rgba(107, 63, 42, 0.08)";
  ctx.fill();

  const meta = document.getElementById("chartMeta");
  const primeiro = historico[0];
  const ultimo = historico[historico.length - 1];
  meta.innerHTML = `
    <span>${formatarData(primeiro.data)} · R$ ${primeiro.preco.toFixed(2)}</span>
    <span>${formatarData(ultimo.data)} · R$ ${ultimo.preco.toFixed(2)} (${unidade})</span>
  `;
}

function formatarData(iso) {
  const [ano, mes, dia] = iso.split("-");
  return dia + "/" + mes;
}

// ---------- MAPA (Google Maps) ----------

const mapaState = { mapa: null, marcadores: [], carregando: false, disponivel: false };

function inicializarMapa() {
  const chave = window.GOOGLE_MAPS_BROWSER_KEY;

  if (!chave) {
    document.getElementById("mapaFallback").hidden = false;
    return;
  }
  if (mapaState.carregando || mapaState.disponivel) return;

  mapaState.carregando = true;
  const script = document.createElement("script");
  script.src = "https://maps.googleapis.com/maps/api/js?key=" + chave + "&callback=__agroalertaMapaPronto";
  script.async = true;
  window.__agroalertaMapaPronto = criarMapa;
  script.onerror = () => {
    document.getElementById("mapaFallback").hidden = false;
    document.getElementById("mapaFallback").textContent =
      "Não foi possível carregar o Google Maps. Verifique a chave em config.js.";
  };
  document.head.appendChild(script);
}

function criarMapa() {
  mapaState.disponivel = true;
  mapaState.mapa = new google.maps.Map(document.getElementById("mapaTalhoes"), {
    center: { lat: -21.5, lng: -45.7 }, // centro aproximado do Sul de Minas
    zoom: 8,
    mapId: "AGROALERTA_MAPA",
    disableDefaultUI: true,
    zoomControl: true,
  });
  atualizarMarcadoresMapa();
}

function atualizarMarcadoresMapa() {
  if (!mapaState.disponivel) return;

  mapaState.marcadores.forEach((m) => m.setMap(null));
  mapaState.marcadores = [];

  const bounds = new google.maps.LatLngBounds();

  state.talhoes.forEach((talhao) => {
    const posicao = { lat: talhao.latitude, lng: talhao.longitude };
    const marcador = new google.maps.Marker({
      position: posicao,
      map: mapaState.mapa,
      title: talhao.nome,
      label: {
        text: NOMES_CULTURA[talhao.cultura]?.charAt(0) || "?",
        color: "#FBFAF5",
        fontSize: "11px",
        fontWeight: "600",
      },
    });

    marcador.addListener("click", () => selecionarTalhao(talhao.id));
    mapaState.marcadores.push(marcador);
    bounds.extend(posicao);
  });

  if (state.talhoes.length > 0) {
    mapaState.mapa.fitBounds(bounds);
    if (state.talhoes.length === 1) mapaState.mapa.setZoom(11);
  }
}

function iniciarApp() {
  carregarStatus();
  carregarTalhoes();
  inicializarMapa();
}

if (restaurarSessao()) {
  mostrarApp();
} else {
  mostrarLogin();
}
