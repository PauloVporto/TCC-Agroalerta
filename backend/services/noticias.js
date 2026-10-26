/**
 * Notícias agrícolas a partir dos RSS dos próprios veículos.
 *
 * A fonte anterior era o Google News. Ele agrega mais veículos, mas o RSS dele
 * não traz resumo (o <description> só repete a manchete) e os links passam por
 * um redirecionador que bloqueia acesso automatizado. Sem resumo e sem link
 * direto não dá para montar a página de notícias com preview, então passamos a
 * ler os feeds dos veículos:
 *
 *   - Canal Rural: aceita busca (?s=), então dá para pedir a cultura direto, e
 *     traz resumo de verdade com link direto da matéria.
 *   - g1 Agronegócios: feed geral e grande (100 itens), filtrado aqui por
 *     palavra-chave da cultura. O <atom:subtitle> dele já é o resumo em texto
 *     limpo, sem crédito de imagem.
 *
 * O Agrolink foi descartado: o feed dele (/rss/noticias.xml) responde 200, mas
 * está parado em julho de 2020 — os 49 itens são todos daquele mês. Serviria
 * notícia de seis anos atrás como se fosse do dia.
 */

const _cache = {};
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 horas

// Termos usados na busca do Canal Rural e na filtragem do feed geral do g1.
// São as duas culturas que o cadastro oferece (services/auth.js) e que o resto
// do painel acompanha: o produtor recebe as notícias da lavoura que declarou.
const TERMOS = {
  cafe: ["café", "cafeeiro", "cafeicultura", "arábica"],
  soja: ["soja", "complexo soja", "oleaginosa"],
};

const MAX_RESUMO = 320;
const MIN_NOTICIAS = 6; // abaixo disso a página fica vazia demais para valer

// Pedaços de HTML que não são notícia e precisam sair antes de achatar as tags:
// a legenda carrega o crédito da foto ("Foto: Canal Rural/...") e o último
// parágrafo do WordPress é a assinatura "O post X apareceu primeiro em Y".
function limparHtml(html) {
  return String(html || "")
    .replace(/<figure[\s\S]*?<\/figure>/gi, " ")
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, " ")
    .replace(/<p>\s*O post[\s\S]*?apareceu primeiro em[\s\S]*?<\/p>/gi, " ");
}

function semTags(texto) {
  return String(texto || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#8217;|&#39;|&rsquo;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// A flag "s" deixa o "." pegar quebra de linha, então não precisamos de [\s\S]
// dentro de string — que é fácil de perder um nível de escape e quebrar calado.
function trechoDaTag(tag, bloco) {
  return bloco.match(new RegExp("<" + tag + "(?:[^>]*)>(.*?)</" + tag + ">", "is"));
}

function campo(tag, bloco) {
  const m = trechoDaTag(tag, bloco);
  return m ? semTags(m[1]) : "";
}

// Corta no fim de frase mais próximo para o preview não terminar no meio de uma palavra.
function resumir(texto) {
  const limpo = semTags(limparHtml(texto));
  if (limpo.length <= MAX_RESUMO) return limpo;
  const corte = limpo.slice(0, MAX_RESUMO);
  const ponto = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("! "), corte.lastIndexOf("? "));
  if (ponto > MAX_RESUMO * 0.6) return corte.slice(0, ponto + 1);
  const espaco = corte.lastIndexOf(" ");
  return (espaco > 0 ? corte.slice(0, espaco) : corte) + "…";
}

function dataLegivel(pubDate) {
  if (!pubDate) return "";
  const d = new Date(pubDate);
  return isNaN(d) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Lê os <item> do XML. `camposResumo` vem em ordem de preferência porque cada
 * veículo guarda o resumo em um lugar: no g1 é <atom:subtitle> (texto puro) e
 * o <description> é só a imagem; no Canal Rural é o <description>.
 */
function parsear(xml, fonte, camposResumo) {
  const blocos = xml.match(/<item[\s\S]*?<\/item>/g) || [];
  return blocos
    .map((bloco) => {
      const pubDate = campo("pubDate", bloco);
      let resumo = "";
      for (const nome of camposResumo) {
        const bruto = trechoDaTag(nome, bloco);
        resumo = bruto ? resumir(bruto[1]) : "";
        if (resumo.length > 40) break;
      }
      return {
        titulo: campo("title", bloco),
        resumo,
        link: campo("link", bloco),
        fonte,
        dataTexto: dataLegivel(pubDate),
        publicadoEm: pubDate ? new Date(pubDate).toISOString() : null,
      };
    })
    .filter((n) => n.titulo.length > 10 && n.resumo.length > 40 && /^https?:\/\//.test(n.link));
}

async function lerFeed(url, fonte, camposResumo) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AgroAlerta/1.0 TCC)",
      Accept: "application/rss+xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new Error(fonte + ": HTTP " + resp.status);
  const xml = await resp.text();
  if (!xml.includes("<item")) throw new Error(fonte + ": resposta sem itens");
  return parsear(xml, fonte, camposResumo);
}

function combina(noticia, termos) {
  const alvo = (noticia.titulo + " " + noticia.resumo).toLowerCase();
  return termos.some((t) => alvo.includes(t.toLowerCase()));
}

/**
 * Notícias da cultura, mais recentes primeiro, sem repetir manchete.
 * Se um dos feeds falhar, o outro ainda alimenta a página.
 */
async function buscarNoticiasCultura(cultura) {
  const termos = TERMOS[cultura];
  if (!termos) return [];

  const chave = "noticias_" + cultura;
  const agora = Date.now();
  if (_cache[chave] && agora - _cache[chave].ts < CACHE_TTL_MS) {
    return _cache[chave].dados;
  }

  const buscaCanalRural =
    "https://www.canalrural.com.br/?s=" + encodeURIComponent(termos[0]) + "&feed=rss2";

  const [canalRural, g1] = await Promise.allSettled([
    lerFeed(buscaCanalRural, "Canal Rural", ["description"]),
    lerFeed("https://g1.globo.com/rss/g1/economia/agronegocios/", "g1 Agronegócios", [
      "atom:subtitle",
      "description",
    ]),
  ]);

  if (canalRural.status === "rejected" && g1.status === "rejected") {
    console.error("[noticias] nenhum feed respondeu para " + cultura);
    return [];
  }

  // Os dois passam pelo mesmo filtro: a busca do Canal Rural devolve matérias
  // só tangencialmente ligadas ao termo, e o feed do g1 é de agro em geral.
  const doCanal = canalRural.status === "fulfilled" ? canalRural.value : [];
  const doG1 = g1.status === "fulfilled" ? g1.value : [];

  const relevantes = doCanal.concat(doG1).filter((n) => combina(n, termos));

  // A busca do Canal Rural casa o termo no corpo da matéria, que não cabe no
  // RSS: há notícia pertinente cujo título e resumo não repetem a palavra. Se o
  // filtro deixou a página magra, completamos com o resto da busca em vez de
  // mostrar duas notícias.
  const escolhidas =
    relevantes.length >= MIN_NOTICIAS
      ? relevantes
      : relevantes.concat(doCanal.filter((n) => !combina(n, termos)));

  const vistos = new Set();
  const noticias = escolhidas
    .filter((n) => {
      const id = n.titulo.toLowerCase();
      if (vistos.has(id)) return false;
      vistos.add(id);
      return true;
    })
    .sort((a, b) => String(b.publicadoEm || "").localeCompare(String(a.publicadoEm || "")))
    .slice(0, 12);

  _cache[chave] = { ts: agora, dados: noticias };
  return noticias;
}

module.exports = { buscarNoticiasCultura, TERMOS };
