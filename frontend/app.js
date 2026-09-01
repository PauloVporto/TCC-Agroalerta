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
  mercadoPeriodoAtual: "6meses",
  mercadoAnoAtual: new Date().getFullYear(),
  mercadoVisao: "comparar",
  mercadoBrasilCompleto: null,
  mercadoInternacionalCompleto: null,
  mercadoProjecao: null,
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

  document.querySelector(".content").classList.toggle("content--full", view === "mercado");
  document.getElementById("sidebar").classList.remove("is-open");

  if (view === "painel") carregarPainel();
  if (view === "talhoes") {
    carregarTalhoes();
    setTimeout(garantirMapaTalhoes, 150);
  }
  if (view === "configuracoes") carregarConfiguracoes();
  if (view === "insumos" && !state.insumosCarregados) carregarInsumos();
  if (view === "mercado" && !state.mercadoCarregado) carregarMercado(state.culturaMercadoAtual);
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
  try {
    const resp = await apiFetch("/painel");
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.erro || "Falha ao carregar o painel");

    kpis.innerHTML = `
      <div class="card kpi-card"><div class="kpi-label">Talhões</div><div class="kpi-value">${dados.totalTalhoes}</div></div>
      <div class="card kpi-card"><div class="kpi-label">Alertas ativos</div><div class="kpi-value">${dados.totalAlertas}</div></div>
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

    alertasEl.innerHTML = dados.alertas.length
      ? '<div class="painel-lista">' +
        dados.alertas
          .map(
            (a) =>
              `<div class="painel-row"><span>${a.nome} · ${NOMES_CULTURA[a.cultura] || a.cultura}</span>` +
              `<span class="nivel-tag ${a.maiorNivel || "baixo"}">${a.total} alerta${a.total === 1 ? "" : "s"}</span></div>`
          )
          .join("") +
        "</div>"
      : '<p class="empty-state">Cadastre um talhão para ver alertas climáticos aqui.</p>';

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
    alertasEl.innerHTML = '<p class="empty-state">Não foi possível carregar a visão geral. Confira se o backend está no ar.</p>';
    cotacoesEl.innerHTML = "";
  }
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
          ${NOMES_CULTURA[t.cultura] || t.cultura} · ${formatarFase(t.fase)}
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

  const areaHtml = talhao.areaHa
    ? `<div class="detail-area">Área mapeada: <strong>${Number(talhao.areaHa).toFixed(2)} ha</strong></div>`
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
        <div class="detail-title">${talhao.nome}</div>
      </div>
      <span class="crop-dot ${talhao.cultura}"></span>
    </div>
    <div class="detail-sub">${NOMES_CULTURA[talhao.cultura] || talhao.cultura} · ${formatarFase(talhao.fase)} · fonte do clima: ${clima.fonte}</div>
    ${areaHtml}
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
  setTimeout(() => {
    garantirMapaCadastro();
    if (cadastroMapaState.mapa) cadastroMapaState.mapa.invalidateSize();
  }, 150);
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
}

formTalhao.addEventListener("submit", async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(formTalhao).entries());

  if ((!dados.latitude || !dados.longitude) && !String(dados.endereco || "").trim()) {
    alert("Marque o talhão no mapa ou informe um endereço.");
    return;
  }

  if (cadastroMapaState.poligono && cadastroMapaState.poligono.length >= 3) {
    dados.poligono = cadastroMapaState.poligono;
  }

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
  renderizarGrafico();
});

document.getElementById("anoSelect").addEventListener("change", (e) => {
  state.mercadoAnoAtual = Number(e.target.value);
  renderizarGrafico();
});

document.getElementById("btnRegerarAnalise").addEventListener("click", () => {
  carregarAnalise(state.culturaMercadoAtual);
});

popularAnoSelect();

function popularAnoSelect() {
  const select = document.getElementById("anoSelect");
  const anoAtual = new Date().getFullYear();
  const anos = [anoAtual, anoAtual - 1, anoAtual - 2];
  select.innerHTML = anos.map((a) => `<option value="${a}">${a}</option>`).join("");
  select.value = String(state.mercadoAnoAtual);
}

async function carregarMercado(cultura) {
  state.mercadoCarregado = true;
  await Promise.all([carregarHistorico(cultura), carregarAnalise(cultura), carregarProjecao(cultura)]);
}

async function carregarHistorico(cultura) {
  const resp = await fetch(API_BASE + "/mercado/" + cultura + "/historico");
  const dados = await resp.json();
  state.mercadoBrasilCompleto = (dados.mercadoInterno && dados.mercadoInterno.historico) || dados.historico || [];
  state.mercadoInternacionalCompleto = (dados.paridade && dados.paridade.historico) || [];
  state.mercadoUnidade = (dados.paridade && dados.paridade.unidade) || dados.unidade;
  renderizarCotasMercado(dados);
  renderizarGrafico();
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
  document.getElementById("projecaoTexto").textContent = "Carregando projeção 30/60/90 dias…";
  document.getElementById("projecaoPontos").innerHTML = "";

  try {
    const resp = await fetch(API_BASE + "/mercado/" + cultura + "/projecao");
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.erro || "Falha na projeção");

    state.mercadoProjecao = dados;
    document.getElementById("projecaoTexto").textContent = dados.resumo;
    document.getElementById("projecaoPontos").innerHTML = (dados.pontos || [])
      .map(
        (p) =>
          `<div class="projecao-ponto">` +
          `<span class="projecao-horizonte">${p.horizonteDias} dias</span>` +
          `<span class="projecao-preco">${formatarMoeda(p.preco)}</span>` +
          `<span class="projecao-data">${formatarData(p.data)}</span>` +
          `</div>`
      )
      .join("");

    renderizarGrafico();
  } catch (erro) {
    state.mercadoProjecao = null;
    document.getElementById("projecaoTexto").textContent = "Não foi possível carregar a projeção agora.";
    document.getElementById("projecaoPontos").innerHTML = "";
  }
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
  const doAno = historico.filter((p) => p.data.startsWith(ano + "-"));
  if (periodo === "ano" || doAno.length === 0) return doAno;

  // janelas móveis (semana, mês, 90 dias...) são ancoradas no último ponto
  // disponível dentro do ano selecionado, não no ano mais recente com dado.
  const corte = new Date(paraTimestamp(doAno[doAno.length - 1].data));
  if (periodo === "7") corte.setUTCDate(corte.getUTCDate() - 7);
  else if (periodo === "mes") corte.setUTCMonth(corte.getUTCMonth() - 1);
  else if (periodo === "90") corte.setUTCDate(corte.getUTCDate() - 90);
  else if (periodo === "3meses") corte.setUTCMonth(corte.getUTCMonth() - 3);
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

function renderizarGrafico() {
  const canvas = document.getElementById("chartMercado");
  const vazio = document.getElementById("chartVazio");
  const meta = document.getElementById("chartMeta");
  if (!state.mercadoBrasilCompleto) return;

  const visao = state.mercadoVisao;
  const series = [];
  if (visao === "brasil" || visao === "comparar") {
    series.push(serieGrafico(state.mercadoBrasilCompleto, "Brasil (interno)", "#4C7A4F", "rgba(76, 122, 79, 0.08)"));
  }
  if ((visao === "internacional" || visao === "comparar") && state.mercadoInternacionalCompleto.length) {
    series.push(serieGrafico(state.mercadoInternacionalCompleto, "Paridade internacional", "#6B3F2A", visao === "internacional" ? "rgba(107, 63, 42, 0.08)" : null));
  }

  const datasets = series.map((s) => s.dataset);
  const projecaoDataset = montarDatasetProjecao(visao);
  if (projecaoDataset) datasets.push(projecaoDataset);

  const alguma = series.some((s) => s.filtrado.length > 0) || Boolean(projecaoDataset);
  if (!alguma) {
    if (mercadoChart) {
      mercadoChart.destroy();
      mercadoChart = null;
    }
    canvas.hidden = true;
    vazio.hidden = false;
    meta.innerHTML = "";
    return;
  }

  canvas.hidden = false;
  vazio.hidden = true;
  if (mercadoChart) mercadoChart.destroy();

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
            maxTicksLimit: 8,
            callback: (valor) => formatarData(paraISO(valor)),
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
            title: (items) => formatarData(paraISO(items[0].parsed.x)),
            label: (item) => item.dataset.label + ": R$ " + item.parsed.y.toFixed(2),
          },
        },
      },
    },
  });

  const usada = series.find((s) => s.filtrado.length) || series[0];
  const primeiro = usada.filtrado[0];
  const ultimo = usada.filtrado[usada.filtrado.length - 1];
  meta.innerHTML = primeiro
    ? `<span>${formatarData(primeiro.data)} · ${formatarMoeda(primeiro.preco)}</span>
       <span>${formatarData(ultimo.data)} · ${formatarMoeda(ultimo.preco)} (${state.mercadoUnidade})</span>`
    : "";
}

function formatarData(iso) {
  const [ano, mes, dia] = iso.split("-");
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
    label: "Projeção 30/60/90d",
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

function definirPontoCadastro(latlng) {
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
  atualizarHintCadastro("Ponto marcado. Use “Delimitar área” para desenhar o polígono da lavoura.");
}

function adicionarVerticeCadastro(latlng) {
  if (cadastroMapaState.marcador) {
    cadastroMapaState.mapa.removeLayer(cadastroMapaState.marcador);
    cadastroMapaState.marcador = null;
  }

  cadastroMapaState.vertices.push(latlng);
  atualizarPreviewPoligonoCadastro();

  const btn = document.getElementById("btnDelimitar");
  if (cadastroMapaState.vertices.length >= 3) {
    btn.textContent = "Fechar polígono";
    atualizarHintCadastro("Clique em “Fechar polígono” ou no primeiro vértice para concluir a área.");
  } else {
    atualizarHintCadastro("Adicione pelo menos 3 pontos para fechar o polígono.");
  }
}

function atualizarPreviewPoligonoCadastro() {
  if (cadastroMapaState.polylineLayer) {
    cadastroMapaState.mapa.removeLayer(cadastroMapaState.polylineLayer);
  }
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

  cadastroMapaState.modoDelimitar = false;
  document.getElementById("btnDelimitar").classList.remove("is-active");
  document.getElementById("btnDelimitar").textContent = "Delimitar área";
  atualizarHintCadastro("Área delimitada. Ajuste com “Limpar marca” se precisar refazer.");
}

function limparVerticesCadastro() {
  cadastroMapaState.vertices = [];
  if (cadastroMapaState.polylineLayer) {
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
  atualizarHintCadastro('Clique no mapa para marcar o talhão. Com “Delimitar área”, clique em 3+ pontos e feche o polígono.');

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
  carregarTalhoes();
}

if (restaurarSessao()) {
  mostrarApp();
} else {
  mostrarLogin();
}
