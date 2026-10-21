/**
 * Gerencia os administradores do Agro Alerta. Só quem tem acesso ao servidor
 * cria um administrador: o cadastro pelo site nunca dá esse papel.
 *
 *   npm run admin -- --listar
 *   npm run admin -- --promover voce@exemplo.com   (a conta precisa existir)
 *   npm run admin -- --rebaixar voce@exemplo.com   (volta a ser produtor)
 *
 * No Docker: docker compose exec backend npm run admin -- --promover voce@exemplo.com
 */

require("dotenv").config();
const { definirPapel, PAPEL_ADMIN } = require("../services/auth");
const { registrarEventoAdmin } = require("../services/notificacoes/controle");
const { pool } = require("../services/db");
const { argumento, temOpcao } = require("./comum");

async function listar() {
  const { rows } = await pool.query("SELECT nome, email FROM usuarios WHERE papel = $1 ORDER BY nome", [PAPEL_ADMIN]);
  if (rows.length === 0) console.log("Nenhum administrador cadastrado.");
  for (const admin of rows) console.log(`${admin.nome} <${admin.email}>`);
}

async function alterar(email, papel, descricao) {
  const conta = await definirPapel(email, papel);
  if (!conta) {
    console.error(`Nenhuma conta com o e-mail ${email}. Crie a conta pelo site e rode de novo.`);
    process.exitCode = 1;
    return;
  }
  await registrarEventoAdmin(pool, {
    categoria: "controle",
    tipo: papel === PAPEL_ADMIN ? "administrador_promovido" : "administrador_rebaixado",
    detalhe: `${conta.nome} <${conta.email}> ${descricao} (pelo servidor).`,
  });
  console.log(`${conta.nome} <${conta.email}> ${descricao}.`);
}

async function main() {
  if (temOpcao("listar")) return listar();
  const promover = argumento("promover");
  if (promover) return alterar(promover, PAPEL_ADMIN, "agora é administrador");
  const rebaixar = argumento("rebaixar");
  if (rebaixar) return alterar(rebaixar, "produtor", "não é mais administrador");
  console.error("Uso: npm run admin -- --listar | --promover <e-mail> | --rebaixar <e-mail>");
  process.exitCode = 1;
}

main()
  .catch((erro) => {
    console.error("Falha:", erro.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
