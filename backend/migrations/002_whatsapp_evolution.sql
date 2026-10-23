-- 002_whatsapp_evolution.sql
--
-- WhatsApp pela Evolution API no lugar do SMS: uma única instância ("agroalerta"),
-- conectada ao número do Agro Alerta, envia as boas-vindas e os alertas de geada.
-- Cria o canal "whatsapp" com consentimento próprio, os estados de entrega do
-- WhatsApp, a validade das mensagens, o controle de despacho do administrador e a
-- trilha de auditoria da conexão.
--
-- Somente alterações aditivas: as restrições CHECK são ampliadas (todo valor aceito
-- antes continua aceito) e nenhuma linha existente é alterada. O histórico e os
-- consentimentos de SMS ficam como estão — consentimento de SMS não vira
-- autorização de WhatsApp: o canal novo começa sem nenhuma linha.
--
-- Para desfazer antes de haver dados do WhatsApp: migrations/rollback/002_whatsapp_evolution.down.sql.

-- Consentimento ----------------------------------------------------------------
-- A linha guarda o número autorizado (destino): se o produtor trocar de celular,
-- a autorização antiga deixa de valer e precisa ser dada de novo.

ALTER TABLE notificacao_consentimentos DROP CONSTRAINT notificacao_consentimentos_canal_check;
ALTER TABLE notificacao_consentimentos ADD CONSTRAINT notificacao_consentimentos_canal_check
  CHECK (canal IN ('email', 'sms', 'whatsapp'));

-- Gravidade mínima do alerta de geada que vai para o WhatsApp.
ALTER TABLE notificacao_preferencias ADD COLUMN IF NOT EXISTS whatsapp_nivel_minimo TEXT NOT NULL DEFAULT 'medio'
  CHECK (whatsapp_nivel_minimo IN ('medio', 'alto'));

-- Fila e histórico ---------------------------------------------------------------
--
-- status no WhatsApp: pendente → processando → enviado (aceito pela Evolution API)
--   → confirmado_servidor (servidor do WhatsApp) → entregue → lido.
-- incerto   = a requisição pode ter saído, mas não houve resposta: nunca é reenviada
--             automaticamente; o administrador decide.
-- cancelado = retirado da fila (revogação do consentimento ou administrador).
-- expirado  = não saiu dentro da validade (ex.: alerta de geada cuja noite já passou).

ALTER TABLE notificacao_envios DROP CONSTRAINT notificacao_envios_canal_check;
ALTER TABLE notificacao_envios ADD CONSTRAINT notificacao_envios_canal_check
  CHECK (canal IN ('email', 'sms', 'whatsapp'));

ALTER TABLE notificacao_envios DROP CONSTRAINT notificacao_envios_status_check;
ALTER TABLE notificacao_envios ADD CONSTRAINT notificacao_envios_status_check
  CHECK (status IN ('pendente', 'processando', 'simulado', 'enviado', 'confirmado_servidor', 'entregue',
                    'lido', 'falhou', 'bloqueado', 'incerto', 'cancelado', 'expirado'));

-- Depois deste instante a mensagem não sai mais (vira "expirado").
ALTER TABLE notificacao_envios ADD COLUMN IF NOT EXISTS expira_em TIMESTAMPTZ;
-- Marcado logo antes de chamar a Evolution API: se o backend cair depois disso, o
-- resultado da tentativa é incerto e a mensagem não é reenviada.
ALTER TABLE notificacao_envios ADD COLUMN IF NOT EXISTS tentativa_iniciada_em TIMESTAMPTZ;
ALTER TABLE notificacao_envios ADD COLUMN IF NOT EXISTS confirmado_servidor_em TIMESTAMPTZ;
ALTER TABLE notificacao_envios ADD COLUMN IF NOT EXISTS lido_em TIMESTAMPTZ;
-- Número que enviou a mensagem (o WhatsApp conectado à instância no momento do envio).
ALTER TABLE notificacao_envios ADD COLUMN IF NOT EXISTS remetente TEXT;

-- Ritmo de envio: os limites por hora e por dia contam as tentativas do WhatsApp.
CREATE INDEX IF NOT EXISTS idx_envios_whatsapp_tentativas
  ON notificacao_envios (tentativa_iniciada_em) WHERE canal = 'whatsapp';
CREATE INDEX IF NOT EXISTS idx_envios_validade
  ON notificacao_envios (expira_em) WHERE status = 'pendente' AND expira_em IS NOT NULL;

-- Webhooks -------------------------------------------------------------------------
-- Um evento de status pode chegar antes da resposta do envio (que traz o id da
-- mensagem): fica guardado sem envio_id e é aplicado assim que o id é gravado.

ALTER TABLE notificacao_webhooks DROP CONSTRAINT notificacao_webhooks_provedor_check;
ALTER TABLE notificacao_webhooks ADD CONSTRAINT notificacao_webhooks_provedor_check
  CHECK (provedor IN ('resend', 'smsgo', 'evolution'));

ALTER TABLE notificacao_webhooks ADD COLUMN IF NOT EXISTS referencia TEXT;
ALTER TABLE notificacao_webhooks ADD COLUMN IF NOT EXISTS envio_id BIGINT REFERENCES notificacao_envios(id) ON DELETE SET NULL;
ALTER TABLE notificacao_webhooks ADD COLUMN IF NOT EXISTS processado_em TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_webhooks_evolution_sem_envio
  ON notificacao_webhooks (referencia) WHERE provedor = 'evolution' AND processado_em IS NULL;

-- Controle de despacho do WhatsApp (linha única) -------------------------------------
-- Alterado só pelo administrador, sem reiniciar nada. Começa com os envios
-- bloqueados: nenhuma mensagem sai até o administrador liberar.

CREATE TABLE IF NOT EXISTS whatsapp_controle (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  envios_bloqueados BOOLEAN NOT NULL DEFAULT TRUE,
  boas_vindas_ativas BOOLEAN NOT NULL DEFAULT TRUE,
  alertas_ativos BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO whatsapp_controle (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Auditoria da administração: conexão do WhatsApp, mudanças de controle e ações na fila.

CREATE TABLE IF NOT EXISTS administracao_eventos (
  id BIGSERIAL PRIMARY KEY,
  categoria TEXT NOT NULL CHECK (categoria IN ('conexao', 'controle', 'fila')),
  tipo TEXT NOT NULL,
  detalhe TEXT,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_administracao_eventos_recentes
  ON administracao_eventos (criado_em DESC, id DESC);
