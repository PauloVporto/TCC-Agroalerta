-- 001_notificacoes.sql
--
-- Base das notificações: contato do produtor, consentimento por canal,
-- preferências, fila persistente de envios, eventos de entrega e webhooks
-- recebidos. Também cria os registros do monitoramento climático automático
-- (leituras e alertas gerados).
--
-- Os valores 'sms'/'smsgo' nas restrições vêm de bancos que já aplicaram esta
-- versão; o canal em uso é o WhatsApp (002_whatsapp_evolution.sql). O SQL desta
-- migration não muda: o executor só registra o nome do arquivo.
--
-- Somente alterações aditivas: nenhuma tabela, coluna ou registro existente é
-- removido. Os CREATE TABLE IF NOT EXISTS de leituras_clima e alertas_gerados
-- repetem a definição já usada no banco local, para que um banco novo fique igual.

-- Contato do produtor -------------------------------------------------------

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone TEXT;

-- Região legível do talhão ("Cidade - UF"), usada nas mensagens ---------------

ALTER TABLE talhoes ADD COLUMN IF NOT EXISTS regiao TEXT;

-- Talhões antigos: quando o endereço começa pela cidade do dono, usa a cidade
-- dele já no formato "Cidade - UF".
UPDATE talhoes t
SET regiao = u.cidade
FROM usuarios u
WHERE t.usuario_id = u.id
  AND t.regiao IS NULL
  AND u.cidade IS NOT NULL
  AND split_part(u.cidade, ' - ', 1) = btrim(split_part(COALESCE(t.endereco_formatado, t.endereco), ',', 1));

-- Demais talhões: "..., Cidade - UF" (endereço montado com o ViaCEP) ou
-- "Cidade, Região, Estado, Brasil" (endereço do Nominatim).
UPDATE talhoes
SET regiao = CASE
  WHEN COALESCE(endereco_formatado, endereco) ~ '[^,]+ - [A-Z]{2}$'
    THEN btrim(substring(COALESCE(endereco_formatado, endereco) FROM '([^,]+ - [A-Z]{2})$'))
  ELSE btrim(split_part(COALESCE(endereco_formatado, endereco), ',', 1))
END
WHERE regiao IS NULL;

-- Consentimento por canal ----------------------------------------------------
-- Só recebe inserções: cada decisão do produtor vira uma linha, formando a
-- trilha de auditoria. O estado atual de um canal é a linha mais recente.

CREATE TABLE IF NOT EXISTS notificacao_consentimentos (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  canal TEXT NOT NULL CHECK (canal IN ('email', 'sms')),
  concedido BOOLEAN NOT NULL,
  destino TEXT,
  origem TEXT NOT NULL CHECK (origem IN ('cadastro', 'painel', 'reclamacao_spam')),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consentimentos_usuario
  ON notificacao_consentimentos (usuario_id, canal, criado_em DESC, id DESC);

-- Gravidade mínima de alerta que dispara cada canal ---------------------------

CREATE TABLE IF NOT EXISTS notificacao_preferencias (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  email_nivel_minimo TEXT NOT NULL DEFAULT 'medio' CHECK (email_nivel_minimo IN ('medio', 'alto')),
  sms_nivel_minimo TEXT NOT NULL DEFAULT 'alto' CHECK (sms_nivel_minimo IN ('medio', 'alto')),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Monitoramento climático -----------------------------------------------------

CREATE TABLE IF NOT EXISTS leituras_clima (
  id SERIAL PRIMARY KEY,
  talhao_id INTEGER REFERENCES talhoes(id) ON DELETE CASCADE,
  fonte TEXT NOT NULL,
  temperatura_minima DOUBLE PRECISION,
  chuva_acumulada_7d DOUBLE PRECISION,
  dias_sem_chuva INTEGER,
  probabilidade_chuva INTEGER,
  vento_maximo_kmh DOUBLE PRECISION,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leituras_clima_talhao ON leituras_clima (talhao_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS alertas_gerados (
  id SERIAL PRIMARY KEY,
  talhao_id INTEGER NOT NULL REFERENCES talhoes(id) ON DELETE CASCADE,
  regra_id TEXT NOT NULL,
  nivel TEXT NOT NULL,
  titulo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  recomendacao TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cada linha é um episódio de risco: enquanto a regra continua disparando,
-- só ultima_deteccao_em avança (o produtor não é avisado de novo).
ALTER TABLE alertas_gerados ADD COLUMN IF NOT EXISTS janela TEXT;
ALTER TABLE alertas_gerados ADD COLUMN IF NOT EXISTS regiao TEXT;
ALTER TABLE alertas_gerados ADD COLUMN IF NOT EXISTS leitura_id INTEGER REFERENCES leituras_clima(id) ON DELETE SET NULL;
ALTER TABLE alertas_gerados ADD COLUMN IF NOT EXISTS ultima_deteccao_em TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_alertas_gerados_episodio
  ON alertas_gerados (talhao_id, regra_id, ultima_deteccao_em DESC);

-- Fila persistente e histórico de envios ----------------------------------------
-- Uma linha por mensagem, canal e destinatário. A chave de idempotência impede
-- que a mesma mensagem seja enfileirada duas vezes.
--
-- status: pendente → processando → simulado | enviado (aceito pelo provedor)
--         → entregue (confirmado) | falhou; bloqueado = barrado por consentimento,
--         contato inválido, limite ou orçamento.

CREATE TABLE IF NOT EXISTS notificacao_envios (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  alerta_id INTEGER REFERENCES alertas_gerados(id) ON DELETE SET NULL,
  canal TEXT NOT NULL CHECK (canal IN ('email', 'sms')),
  tipo TEXT NOT NULL CHECK (tipo IN ('boas_vindas', 'alerta_climatico', 'teste')),
  chave_idempotencia TEXT NOT NULL UNIQUE,
  destino TEXT,
  assunto TEXT,
  conteudo TEXT NOT NULL,
  conteudo_html TEXT,
  resumo TEXT NOT NULL,
  regiao TEXT,
  nivel TEXT,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'processando', 'simulado', 'enviado', 'entregue', 'falhou', 'bloqueado')),
  modo TEXT CHECK (modo IN ('simulado', 'sandbox', 'real')),
  provedor TEXT,
  provedor_id TEXT,
  tentativas INTEGER NOT NULL DEFAULT 0,
  max_tentativas INTEGER NOT NULL DEFAULT 5,
  proxima_tentativa_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processando_ate TIMESTAMPTZ,
  segmentos INTEGER,
  custo_estimado NUMERIC(10, 4),
  erro_codigo TEXT,
  erro_mensagem TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enviado_em TIMESTAMPTZ,
  entregue_em TIMESTAMPTZ,
  status_consultado_em TIMESTAMPTZ,
  -- Só os testes manuais de provedor não pertencem a um produtor.
  CHECK (usuario_id IS NOT NULL OR tipo = 'teste')
);

CREATE INDEX IF NOT EXISTS idx_envios_fila
  ON notificacao_envios (proxima_tentativa_em) WHERE status IN ('pendente', 'processando');
CREATE INDEX IF NOT EXISTS idx_envios_usuario ON notificacao_envios (usuario_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_envios_provedor ON notificacao_envios (provedor, provedor_id);
CREATE INDEX IF NOT EXISTS idx_envios_consumo_sms
  ON notificacao_envios (modo, enviado_em) WHERE canal = 'sms';

-- Linha do tempo de cada envio (tentativas, erros, confirmações) -----------------

CREATE TABLE IF NOT EXISTS notificacao_eventos (
  id BIGSERIAL PRIMARY KEY,
  envio_id BIGINT NOT NULL REFERENCES notificacao_envios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  status TEXT,
  detalhe TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eventos_envio ON notificacao_eventos (envio_id, criado_em);

-- Webhooks recebidos (já com assinatura validada); a unicidade descarta repetições.

CREATE TABLE IF NOT EXISTS notificacao_webhooks (
  id BIGSERIAL PRIMARY KEY,
  provedor TEXT NOT NULL CHECK (provedor IN ('resend', 'smsgo')),
  evento_id TEXT NOT NULL,
  tipo TEXT,
  payload JSONB NOT NULL,
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provedor, evento_id)
);
