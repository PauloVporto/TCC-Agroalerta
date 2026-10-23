-- Retenção administrativa persistente: uma pendência retida não é despachada
-- nem expirada pelo worker. O status e o histórico originais são preservados.
ALTER TABLE notificacao_envios ADD COLUMN IF NOT EXISTS retido_em TIMESTAMPTZ;
ALTER TABLE notificacao_envios ADD COLUMN IF NOT EXISTS retencao_motivo TEXT;
CREATE INDEX IF NOT EXISTS idx_envios_whatsapp_liberados
  ON notificacao_envios (proxima_tentativa_em, id)
  WHERE canal = 'whatsapp' AND status = 'pendente' AND retido_em IS NULL;
