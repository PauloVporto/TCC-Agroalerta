const { mensagens, verificarAutenticacao } = require('../../../backend/services/anthropic');
const payload = { model: 'claude-haiku-4-5-20251001', max_tokens: 20, messages: [{ role: 'user', content: 'Teste' }] };
const originalFetch = global.fetch;
const originalKey = process.env.ANTHROPIC_API_KEY;
afterEach(() => { global.fetch = originalFetch; if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = originalKey; delete process.env.ANTHROPIC_TIMEOUT_MS; });
function sucesso(texto = 'Texto válido') { return { ok: true, headers: { get: () => 'req_teste' }, json: async () => ({ id: 'msg_teste', model: payload.model, stop_reason: 'end_turn', content: [{ type: 'text', text: texto }] }) }; }
test('lê chave atual na chamada, mesmo importado antes de configurar ou trocar', async () => {
  global.fetch = jest.fn().mockResolvedValue(sucesso());
  process.env.ANTHROPIC_API_KEY = 'chave-ficticia-1';
  await mensagens(payload);
  process.env.ANTHROPIC_API_KEY = ' chave-ficticia-2 ';
  const r = await mensagens(payload);
  expect(global.fetch.mock.calls.map(c => c[1].headers['x-api-key'])).toEqual(['chave-ficticia-1', 'chave-ficticia-2']);
  expect(r).toMatchObject({ texto: 'Texto válido', requestId: 'req_teste', dados: { id: 'msg_teste' } });
});
test('chave ausente falha antes da rede', async () => {
  delete process.env.ANTHROPIC_API_KEY; global.fetch = jest.fn();
  await expect(mensagens(payload)).rejects.toMatchObject({ codigo: 'nao_configurada' });
  expect(global.fetch).not.toHaveBeenCalled();
});
test('chave com quebra interna falha antes da rede', async () => {
  process.env.ANTHROPIC_API_KEY = 'ficticia\ninvalida'; global.fetch = jest.fn();
  await expect(mensagens(payload)).rejects.toMatchObject({ codigo: 'chave_malformada' });
  expect(global.fetch).not.toHaveBeenCalled();
});
test.each([[401,'autenticacao'],[403,'permissao'],[429,'limite'],[500,'provedor']])('HTTP %s gera código seguro %s sem propagar corpo', async (status,codigo) => {
  process.env.ANTHROPIC_API_KEY = 'segredo-ficticio';
  const text = jest.fn().mockResolvedValue('segredo-ficticio dados pessoais');
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status, text, headers: { get: () => 'req_teste' } });
  await expect(mensagens(payload)).rejects.toMatchObject({ codigo, status, requestId: 'req_teste' });
  expect(text).not.toHaveBeenCalled();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('timeout vira erro próprio, sem repetição ou conteúdo de erro de rede', async () => {
  process.env.ANTHROPIC_API_KEY = 'ficticia';
  global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('conteudo-sensivel'), { name: 'TimeoutError' }));
  await expect(mensagens(payload)).rejects.toMatchObject({ codigo: 'tempo_limite' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('falha de rede não vaza mensagem original', async () => {
  process.env.ANTHROPIC_API_KEY = 'ficticia';
  global.fetch = jest.fn().mockRejectedValue(new Error('conteudo-sensivel'));
  await expect(mensagens(payload)).rejects.toMatchObject({ codigo: 'rede' });
  await expect(mensagens(payload)).rejects.not.toThrow('conteudo-sensivel');
});
test.each([{}, {content:[]}, {content:[{type:'text',text:'parcial'}],stop_reason:'max_tokens'}])('resposta inválida não vira análise real', async dados => {
  process.env.ANTHROPIC_API_KEY = 'ficticia';
  global.fetch = jest.fn().mockResolvedValue({ ok:true,json:async()=>dados });
  await expect(mensagens(payload)).rejects.toMatchObject({ codigo:'resposta_invalida' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('diagnóstico faz GET de modelos sem gerar mensagem', async () => {
  process.env.ANTHROPIC_API_KEY = 'ficticia';
  global.fetch = jest.fn().mockResolvedValue({ ok:true,json:async()=>({data:[]}) });
  expect(await verificarAutenticacao()).toMatchObject({autenticado:true});
  expect(global.fetch.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/models?limit=1');
  expect(global.fetch.mock.calls[0][1].method).toBe('GET');
  expect(global.fetch.mock.calls[0][1].body).toBeUndefined();
});
test('mercado informa autenticação rejeitada sem marcar fallback como Claude', async () => {
  process.env.ANTHROPIC_API_KEY = 'ficticia';
  jest.resetModules();
  jest.doMock('../../../backend/services/noticias', () => ({ buscarNoticiasCultura: jest.fn().mockResolvedValue([]) }));
  global.fetch = jest.fn().mockResolvedValue({ok:false,status:401});
  const resultado = await require('../../../backend/services/market').gerarAnaliseTendencia('cafe');
  expect(resultado.gerarPor).toBe('simulado');
  expect(resultado.ia).toMatchObject({status:'indisponivel',codigo:'autenticacao'});
  jest.dontMock('../../../backend/services/noticias');
});
