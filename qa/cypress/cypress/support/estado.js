/**
 * Estado compartilhado entre os steps de um mesmo cenário.
 * É zerado no hook Before (ver step_definitions/common/sessao.steps.js).
 */
export const estado = {
  sessao: null, // { usuario, token, dados } da conta criada pela API
  extra: {}, // valores específicos de cada cenário (ex.: nome digitado, nº de talhões antes)
};

export function reiniciarEstado() {
  estado.sessao = null;
  estado.extra = {};
}
