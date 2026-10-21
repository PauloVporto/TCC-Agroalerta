const { obterConsentimentos, autorizacaoVigente } = require("./consentimentos");

async function destinatarioTesteAutorizado(db, destino) {
  const { rows } = await db.query("SELECT id, nome, telefone FROM usuarios WHERE telefone = $1", [destino]);
  if (rows.length !== 1) throw new Error("O teste exige um único produtor cadastrado para o telefone informado.");
  const produtor = rows[0];
  const decisoes = await obterConsentimentos(produtor.id, db);
  if (!autorizacaoVigente("whatsapp", decisoes.whatsapp, produtor.telefone)) {
    throw new Error("O destinatário precisa autorizar o WhatsApp nas preferências atuais do Agro Alerta. Consentimentos legados não são convertidos automaticamente.");
  }
  return produtor;
}

module.exports = { destinatarioTesteAutorizado };
