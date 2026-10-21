-- Defaults seguros para instalações novas. Não altera decisões administrativas existentes.
ALTER TABLE whatsapp_controle ALTER COLUMN boas_vindas_ativas SET DEFAULT FALSE;
ALTER TABLE whatsapp_controle ALTER COLUMN alertas_ativos SET DEFAULT FALSE;
-- A linha original só é bloqueada se nunca houve uma decisão administrativa.
UPDATE whatsapp_controle SET envios_bloqueados = TRUE, boas_vindas_ativas = FALSE,
  alertas_ativos = FALSE WHERE atualizado_por IS NULL
  AND NOT EXISTS (SELECT 1 FROM administracao_eventos WHERE categoria = 'controle');
