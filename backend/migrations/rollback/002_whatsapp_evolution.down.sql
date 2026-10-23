-- Desfaz a migration 002_whatsapp_evolution.sql.
--
-- Fica fora da pasta lida na subida do backend: só roda manualmente, numa
-- transação, e apenas enquanto o WhatsApp ainda não gerou dados. Se já houver
-- qualquer consentimento, envio, webhook ou registro de administração criado pela
-- 002, ela é abortada sem mudar nada — nesse caso o caminho é restaurar o backup
-- feito antes da migration (docs/WHATSAPP_EVOLUTION.md, seção "Rollback").
--
-- Uso: docker compose exec -T db psql -U agroalerta -d agroalerta -v ON_ERROR_STOP=1 --single-transaction \
--        < backend/migrations/rollback/002_whatsapp_evolution.down.sql

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM notificacao_consentimentos WHERE canal = 'whatsapp')
     OR EXISTS (SELECT 1 FROM notificacao_envios
                WHERE canal = 'whatsapp'
                   OR status IN ('confirmado_servidor', 'lido', 'incerto', 'cancelado', 'expirado')
                   OR expira_em IS NOT NULL OR tentativa_iniciada_em IS NOT NULL)
     OR EXISTS (SELECT 1 FROM notificacao_webhooks WHERE provedor = 'evolution' OR referencia IS NOT NULL)
     OR EXISTS (SELECT 1 FROM administracao_eventos)
     OR EXISTS (SELECT 1 FROM notificacao_preferencias WHERE whatsapp_nivel_minimo <> 'medio') THEN
    RAISE EXCEPTION 'A migration 002 já tem dados do WhatsApp; restaure o backup feito antes dela em vez de desfazê-la.';
  END IF;
END $$;

DROP TABLE administracao_eventos;
DROP TABLE whatsapp_controle;

DROP INDEX idx_webhooks_evolution_sem_envio;
ALTER TABLE notificacao_webhooks DROP COLUMN processado_em, DROP COLUMN envio_id, DROP COLUMN referencia;
ALTER TABLE notificacao_webhooks DROP CONSTRAINT notificacao_webhooks_provedor_check;
ALTER TABLE notificacao_webhooks ADD CONSTRAINT notificacao_webhooks_provedor_check
  CHECK (provedor IN ('resend', 'smsgo'));

DROP INDEX idx_envios_validade;
DROP INDEX idx_envios_whatsapp_tentativas;
ALTER TABLE notificacao_envios
  DROP COLUMN remetente, DROP COLUMN lido_em, DROP COLUMN confirmado_servidor_em,
  DROP COLUMN tentativa_iniciada_em, DROP COLUMN expira_em;
ALTER TABLE notificacao_envios DROP CONSTRAINT notificacao_envios_status_check;
ALTER TABLE notificacao_envios ADD CONSTRAINT notificacao_envios_status_check
  CHECK (status IN ('pendente', 'processando', 'simulado', 'enviado', 'entregue', 'falhou', 'bloqueado'));
ALTER TABLE notificacao_envios DROP CONSTRAINT notificacao_envios_canal_check;
ALTER TABLE notificacao_envios ADD CONSTRAINT notificacao_envios_canal_check
  CHECK (canal IN ('email', 'sms'));

ALTER TABLE notificacao_preferencias DROP COLUMN whatsapp_nivel_minimo;

ALTER TABLE notificacao_consentimentos DROP CONSTRAINT notificacao_consentimentos_canal_check;
ALTER TABLE notificacao_consentimentos ADD CONSTRAINT notificacao_consentimentos_canal_check
  CHECK (canal IN ('email', 'sms'));

DELETE FROM schema_migrations WHERE versao = '002_whatsapp_evolution.sql';
