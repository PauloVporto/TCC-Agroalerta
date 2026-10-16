/**
 * Google News RSS – notícias agrícolas em português, sem necessidade de chave.
 * Retorna manchetes de veículos como Globo Rural, Canal Rural, Notícias Agrícolas, etc.
 * URL base: https://news.google.com/rss/search?q=QUERY&hl=pt-BR&gl=BR&ceid=BR:pt-419
 */

const _cache = {};
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 horas

const QUERIES = {
  cafe:   'café arábica OR "safra café" OR "preço café" OR "saca de café" Minas Gerais',
  soja:   '"preço soja" OR "safra soja" OR "soja Brasil" OR "exportação soja"',
  milho:  '"preço milho" OR "safra milho" OR "milho Brasil" OR "etanol milho"',
  cana:   '"cana-de-açúcar" OR "preço açúcar" OR "safra cana" OR "usina açúcar" Brasil',
  feijao: '"preço feijão" OR "safra feijão" OR "feijão carioca" Brasil',
};

function extrairTexto(tag, bloco) {
  // Suporta CDATA e texto simples com entidades HTML
  const cdata = bloco.match(new RegExp('<' + tag + '(?:[^>]*)><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>', 'i'));
  if (cdata) return cdata[1].trim();
  const plain = bloco.match(new RegExp('<' + tag + '(?:[^>]*)>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  if (!plain) return '';
  return plain[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '') // remove qualquer tag HTML residual
    .trim();
}

function parsearRss(xml) {
  const blocos = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  return blocos
    .map((bloco) => {
      const tituloRaw = extrairTexto('title', bloco);
      const fonteMatch = bloco.match(/<source[^>]*>([^<]*)<\/source>/);
      const fonte = fonteMatch ? fonteMatch[1].trim() : '';
      const pubDateRaw = extrairTexto('pubDate', bloco);

      // Google News coloca " - NomeDaFonte" no final do título; removemos
      let titulo = tituloRaw;
      if (fonte && titulo.endsWith(' - ' + fonte)) {
        titulo = titulo.slice(0, titulo.length - 3 - fonte.length).trim();
      } else {
        const idx = titulo.lastIndexOf(' - ');
        if (idx !== -1) titulo = titulo.slice(0, idx).trim();
      }

      // Data legível: "22 set. 2026" a partir do pubDate RFC-2822
      let dataTexto = '';
      if (pubDateRaw) {
        const d = new Date(pubDateRaw);
        if (!isNaN(d)) {
          dataTexto = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
        }
      }

      return { titulo, fonte: fonte || 'Google News', dataTexto };
    })
    .filter((item) => item.titulo.length > 10);
}

async function buscarNoticiasCultura(cultura) {
  const query = QUERIES[cultura];
  if (!query) return [];

  const chave = 'gnews_' + cultura;
  const agora = Date.now();
  if (_cache[chave] && agora - _cache[chave].ts < CACHE_TTL_MS) {
    return _cache[chave].dados;
  }

  const url =
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(query) +
    '&hl=pt-BR&gl=BR&ceid=BR:pt-419';

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AgroAlerta/1.0 TCC)',
        Accept: 'application/rss+xml, text/xml, */*',
      },
    });
    if (!resp.ok) return [];

    const xml = await resp.text();
    if (!xml.includes('<item>')) return [];

    const noticias = parsearRss(xml).slice(0, 5);
    _cache[chave] = { ts: agora, dados: noticias };
    return noticias;
  } catch (e) {
    console.error('[googlenews] Erro ao buscar notícias para ' + cultura + ':', e.message);
    return [];
  }
}

module.exports = { buscarNoticiasCultura };
