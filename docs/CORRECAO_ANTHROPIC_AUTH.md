# Correção do carregamento e diagnóstico Anthropic

Branch: `fix/anthropic-auth`, baseada em `fix/att-qa` (3b7c807). Sem alteração dos limiares climáticos, banco ou credenciais. Não contém a integração climática local da outra branch.

## Problemas corrigidos

- O servidor carregava `.env` relativamente ao diretório corrente. Agora usa explicitamente `backend/.env`. Variáveis já definidas no ambiente continuam com prioridade; reiniciar o backend após editar o arquivo.
- Mercado, insumos e LLM guardavam a chave ao importar o módulo. Agora o cliente compartilhado lê a configuração do processo a cada chamada. Não relê `.env` em cada requisição.
- Erros propagavam corpo do provedor aos logs. Agora há códigos seguros para autenticação, permissão, limite, timeout e falhas de rede.
- Respostas vazias podiam ser identificadas como IA. Agora são inválidas; os fallbacks preservam origem `simulado` e acrescentam estado explícito de indisponibilidade.
- A interface passa a identificar o resumo alternativo como demonstrativo e a IA como indisponível.

## Diagnóstico sem geração de análise

No backend, executar `npm run ia:diagnostico`. O script consulta `GET /v1/models?limit=1`, usando o mesmo cliente e configuração. Não faz POST de mensagens, não avalia cenários e não imprime a chave. Esta consulta comprova somente autenticação, não geração ou qualidade de respostas.

Referência: https://platform.claude.com/docs/en/api/models/list

## Limite da correção

Um HTTP 401 `invalid x-api-key` recebido diretamente da Anthropic também ocorre fora da aplicação; não há correção de código que torne válida uma credencial rejeitada pelo provedor. O diagnóstico real após esta correção continuou retornando 401. Não foi gerada resposta de IA e nenhuma análise simulada foi apresentada como real.

É necessário usar uma chave ativa da API Anthropic, criada no console correto. Chaves de outros provedores e tokens de login não são equivalentes. Nunca enviar credenciais em chats ou versioná-las.

## Testes

A suíte inclui leitura tardia/troca de configuração, ausência de chave, espaços internos, HTTP 401/403/429/500, timeout, falha de rede, resposta vazia/truncada e GET de diagnóstico. Testes automatizados utilizam mocks. A execução real de diagnóstico é distinta e permaneceu rejeitada pelo provedor.

Validação final: 405 testes Jest aprovados em 18 suítes, zero falhas; 161 testes Node aprovados, zero falhas. Nenhum commit ou push realizado.
