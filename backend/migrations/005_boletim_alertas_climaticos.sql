-- Aditiva; não atualiza consentimentos, controles legados ou mensagens históricas.
CREATE TABLE IF NOT EXISTS notificacao_categorias (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  telefone_autorizado TEXT,
  boletim_diario BOOLEAN NOT NULL DEFAULT FALSE,
  geada BOOLEAN DEFAULT NULL, -- NULL preserva somente a autorização legada de geada.
  chuva_intensa BOOLEAN NOT NULL DEFAULT FALSE,
  vento_forte BOOLEAN NOT NULL DEFAULT FALSE,
  calor_extremo BOOLEAN NOT NULL DEFAULT FALSE,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS notificacao_categorias_auditoria (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL,
  autorizado BOOLEAN NOT NULL,
  telefone TEXT,
  origem TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS clima_controle (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1),
  boletins_pausados BOOLEAN NOT NULL DEFAULT TRUE,
  novos_alertas_pausados BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO clima_controle(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS boletim_execucoes (
  data_local DATE PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('processando','concluido','parcial','falhou')),
  iniciado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalizado_em TIMESTAMPTZ,
  resumo JSONB NOT NULL DEFAULT '{}'::jsonb,
  erro TEXT
);
ALTER TABLE notificacao_envios DROP CONSTRAINT notificacao_envios_tipo_check;
ALTER TABLE notificacao_envios ADD CONSTRAINT notificacao_envios_tipo_check
  CHECK(tipo IN ('boas_vindas','alerta_climatico','teste','boletim_diario','alerta_meteorologico'));
ALTER TABLE notificacao_envios ADD COLUMN IF NOT EXISTS categoria TEXT
  CHECK(categoria IN ('boletim_diario','geada','chuva_intensa','vento_forte','calor_extremo'));
ALTER TABLE notificacao_envios ADD COLUMN IF NOT EXISTS prioridade SMALLINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_fila_prioridade ON notificacao_envios(prioridade DESC,proxima_tentativa_em,id)
  WHERE status='pendente' AND retido_em IS NULL;
ALTER TABLE alertas_gerados ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE alertas_gerados ADD COLUMN IF NOT EXISTS intensidade DOUBLE PRECISION;
