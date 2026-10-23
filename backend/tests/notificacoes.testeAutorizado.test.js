const { test } = require("node:test");
const assert = require("node:assert/strict");
const { destinatarioTesteAutorizado } = require("../services/notificacoes/testeAutorizado");
const telefone = "+5535999993362";
function banco({ usuarios = [{ id: 1, nome: "Produtor fictício", telefone }], decisoes = [] } = {}) {
  return { query: async (sql) => ({ rows: sql.includes("FROM usuarios") ? usuarios : decisoes }) };
}
test("teste real exige autorização explícita atual, sem presumir consentimento legado", async () => {
  await assert.rejects(destinatarioTesteAutorizado(banco(), telefone), /precisa autorizar/);
  for (const decisao of [{ concedido: false, destino: telefone }, { concedido: true, destino: "+5535999990000" }]) {
    await assert.rejects(destinatarioTesteAutorizado(banco({ decisoes: [{ canal: "whatsapp", ...decisao }] }), telefone), /precisa autorizar/);
  }
  const produtor = await destinatarioTesteAutorizado(banco({ decisoes: [{ canal: "whatsapp", concedido: true, destino: telefone }] }), telefone);
  assert.equal(produtor.id, 1);
});
test("teste real recusa destinatário inexistente ou ambíguo", async () => {
  for (const usuarios of [[], [{ id: 1 }, { id: 2 }]]) {
    await assert.rejects(destinatarioTesteAutorizado(banco({ usuarios }), telefone), /único produtor/);
  }
});
