/**
 * INMET – Avisos Especiais Meteorológicos (alertas oficiais do governo federal).
 * Endpoint público: https://apiprevmet3.inmet.gov.br/avisos/ativos
 * Sem autenticação. Retorna alertas ativos filtrados por UF.
 * Degrada graciosamente: se o endpoint estiver indisponível, retorna [].
 */

const _cache = {};
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

const NIVEL_MAP = {
  amarelo: 'baixo',
  laranja: 'medio',
  vermelho: 'alto',
  low: 'baixo',
  moderate: 'medio',
  severe: 'alto',
  extreme: 'alto',
};

function _extrairEstados(raw) {
  if (Array.isArray(raw.estados)) return raw.estados;
  if (raw.aviso && Array.isArray(raw.aviso.estados)) return raw.aviso.estados;
  if (Array.isArray(raw.geocode_states)) return raw.geocode_states;
  if (raw.properties && Array.isArray(raw.properties.estados)) return raw.properties.estados;
  if (typeof raw.estado === 'string') return [raw.estado];
  return [];
}

function _formatarJanela(inicio, fim) {
  if (!inicio && !fim) return '—';
  try {
    const fmt = (str) => {
      const d = new Date(String(str).replace(' ', 'T').replace(/([+-]\d{2}:\d{2})?$/, (m) => m || '-03:00'));
      if (isNaN(d)) return str;
      return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    };
    return fmt(inicio) + ' – ' + fmt(fim);
  } catch {
    return (inicio || '') + ' – ' + (fim || '');
  }
}

function _parsear(raw) {
  const nivel_raw = String(
    raw.nivel_severidade || raw.nivel || raw.severidade || raw.properties?.nivel || ''
  ).toLowerCase();
  const nivel = NIVEL_MAP[nivel_raw] || 'baixo';

  const descricao =
    raw.descricao_do_aviso ||
    raw.descricao ||
    raw.titulo ||
    raw.properties?.descricao ||
    raw.event ||
    '';

  const instrucao =
    raw.instrucoes ||
    raw.instrucao ||
    raw.descricao_risco ||
    raw.properties?.instrucao ||
    raw.description ||
    '';

  const dataInicio = raw.data_inicio || raw.data_inicio_utc || raw.properties?.data_inicio || raw.onset || '';
  const dataFim = raw.data_fim || raw.data_fim_utc || raw.properties?.data_fim || raw.expires || '';
  const estados = _extrairEstados(raw);
  const janela = _formatarJanela(dataInicio, dataFim);

  return { nivel, descricao, instrucao, dataInicio, dataFim, estados, janela };
}

/**
 * Busca avisos oficiais ativos do INMET, filtrando pela UF do talhão.
 * @param {string} uf - sigla do estado (ex: "MG"). Se vazio, retorna todos.
 * @returns {Promise<Array>} lista de alertas oficiais
 */
async function buscarAlertasINMET(uf) {
  const chave = 'inmet_' + (uf || 'todos');
  const agora = Date.now();
  if (_cache[chave] && agora - _cache[chave].ts < CACHE_TTL_MS) {
    return _cache[chave].dados;
  }

  try {
    const resp = await fetch('https://apiprevmet3.inmet.gov.br/avisos/ativos', {
      headers: {
        'User-Agent': 'AgroAlerta/1.0 TCC',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      console.warn('[inmet] API retornou status ' + resp.status);
      return [];
    }

    const texto = await resp.text();
    if (!texto || texto.trim().length < 2) return [];

    let dados;
    try {
      dados = JSON.parse(texto);
    } catch {
      console.warn('[inmet] Resposta não é JSON válido');
      return [];
    }

    const lista = Array.isArray(dados)
      ? dados
      : Array.isArray(dados.avisos)
        ? dados.avisos
        : Array.isArray(dados.features)
          ? dados.features.map((f) => Object.assign({}, f.properties, { _type: 'geojson' }))
          : [];

    const alertas = lista
      .map(_parsear)
      .filter((a) => {
        if (!a.descricao) return false;
        if (!uf || a.estados.length === 0) return true;
        return a.estados.some((e) => e.toUpperCase() === uf.toUpperCase());
      });

    _cache[chave] = { ts: agora, dados: alertas };
    return alertas;
  } catch (erro) {
    console.error('[inmet] Erro ao consultar API:', erro.message);
    return [];
  }
}

/**
 * Extrai a sigla UF de um endereço formatado (ex: "Lavras - MG" → "MG").
 */
function extrairUF(endereco) {
  if (!endereco) return '';
  const m = endereco.match(/\b([A-Z]{2})\s*$/);
  return m ? m[1] : '';
}

module.exports = { buscarAlertasINMET, extrairUF };
