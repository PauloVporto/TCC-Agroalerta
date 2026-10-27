const path = require('node:path');
// Usa o mesmo arquivo e a mesma precedência do servidor: ambiente tem prioridade.
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { chaveConfigurada, verificarAutenticacao, estadoFalha } = require('../services/anthropic');
async function diagnosticar() {
  console.log('Chave configurada: ' + (chaveConfigurada() ? 'sim' : 'não'));
  try {
    const resultado = await verificarAutenticacao();
    console.log('Autenticação aceita pela Anthropic. Request ID: ' + (resultado.requestId || 'indisponível'));
    console.log('Somente metadados consultados; nenhuma análise foi gerada.');
  } catch (erro) {
    console.error(estadoFalha(erro).mensagem);
    process.exitCode = 1;
  }
}
if (require.main === module) diagnosticar();
module.exports = { diagnosticar };
