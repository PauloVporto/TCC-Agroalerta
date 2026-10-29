/**
 * Rótulo do menu lateral -> atributo data-cy do botão correspondente.
 *
 * Fica aqui, e não dentro de um arquivo de steps, porque mais de uma feature
 * navega pelo menu. Antes o mapa existia duplicado em dois arquivos e bastava
 * atualizar um deles para o outro procurar por [data-cy="undefined"].
 */
export const NAV = {
  "Visão geral": "nav-visao",
  Alertas: "nav-alertas",
  Talhões: "nav-talhoes",
  Notificações: "nav-notificacoes",
  "Insumos e preços": "nav-insumos",
  Mercado: "nav-mercado",
  Relatórios: "nav-relatorios",
  Notícias: "nav-noticias",
};
