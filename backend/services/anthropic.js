// Um único cliente para que mercado, insumos e LLM usem a mesma configuração.
const MENSAGENS = {
  nao_configurada: 'A chave da API Anthropic não está configurada no backend.',
  chave_malformada: 'A chave Anthropic contém espaços ou quebras de linha internas.',
  autenticacao: 'A Anthropic rejeitou a chave (HTTP 401). Verifique a credencial no Claude Console.',
  permissao: 'A credencial não tem permissão para esta operação na Anthropic.',
  limite: 'O limite de requisições da Anthropic foi atingido.',
  tempo_limite: 'A Anthropic não respondeu dentro do tempo limite.',
  rede: 'Não foi possível acessar a Anthropic.',
  resposta_invalida: 'A Anthropic retornou uma resposta inválida.',
  provedor: 'A Anthropic está indisponível para esta operação.',
};
function erroIA(codigo, status = null, requestId = null) {
  const erro = new Error(MENSAGENS[codigo]);
  return Object.assign(erro, { codigo, status, requestId });
}
function chaveConfigurada() { return Boolean((process.env.ANTHROPIC_API_KEY || '').trim()); }
function timeoutMs() {
  const n = Number(process.env.ANTHROPIC_TIMEOUT_MS);
  return Number.isInteger(n) && n >= 1000 && n <= 60000 ? n : 15000;
}
async function requisitar(caminho, payload) {
  // Ler a cada chamada evita reter chave antiga quando a configuração do processo muda.
  const chave = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!chave) throw erroIA('nao_configurada');
  if (/\s/.test(chave)) throw erroIA('chave_malformada');
  let resposta;
  try {
    resposta = await fetch('https://api.anthropic.com/v1/' + caminho, {
      method: payload ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(timeoutMs()),
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
  } catch (erro) {
    throw erroIA(['AbortError', 'TimeoutError'].includes(erro.name) ? 'tempo_limite' : 'rede');
  }
  const requestId = resposta.headers?.get?.('request-id') || null;
  if (!resposta.ok) {
    const codigo = ({ 401: 'autenticacao', 403: 'permissao', 429: 'limite' })[resposta.status] || 'provedor';
    // Não propagar corpo do provedor, prompt, URL com credencial ou headers.
    throw erroIA(codigo, resposta.status, requestId);
  }
  let dados;
  try { dados = await resposta.json(); }
  catch (erro) {
    throw erroIA(['AbortError', 'TimeoutError'].includes(erro.name) ? 'tempo_limite' : 'resposta_invalida');
  }
  return { dados, requestId };
}
function extrairTexto(dados) {
  if (!dados || !Array.isArray(dados.content) || dados.stop_reason === 'max_tokens') throw erroIA('resposta_invalida');
  const texto = dados.content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n').trim();
  if (!texto) throw erroIA('resposta_invalida');
  return texto;
}
async function mensagens(payload) {
  const { dados, requestId } = await requisitar('messages', payload);
  return { dados, texto: extrairTexto(dados), requestId };
}
async function verificarAutenticacao() {
  // Consulta de metadados: não gera análise nem consome um cenário do experimento.
  const { dados, requestId } = await requisitar('models?limit=1');
  if (!dados || !Array.isArray(dados.data)) throw erroIA('resposta_invalida');
  return { autenticado: true, requestId };
}
function estadoFalha(erro) {
  const codigo = Object.hasOwn(MENSAGENS, erro.codigo) ? erro.codigo : 'provedor';
  return { status: 'indisponivel', codigo, mensagem: MENSAGENS[codigo] };
}
module.exports = { chaveConfigurada, mensagens, verificarAutenticacao, estadoFalha };
