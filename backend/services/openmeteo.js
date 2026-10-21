/**
 * Open-Meteo – previsão e histórico climáticos para o motor de alertas agrícolas.
 * API gratuita, sem chave. Fornece variáveis agronômicas precisas (evapotranspiração,
 * temperatura mínima, chuva acumulada histórica) não disponíveis no plano gratuito do OWM.
 * Docs: https://open-meteo.com/en/docs
 */

const _cache = {};
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

function _fmtData(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dia;
}

function _cacheKey(prefixo, lat, lon, extra) {
  return prefixo + '_' + lat.toFixed(3) + '_' + lon.toFixed(3) + (extra ? '_' + extra : '');
}

async function _fetch(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'AgroAlerta/1.0 TCC' },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error('Open-Meteo HTTP ' + resp.status);
  const dados = await resp.json();
  if (dados.error) throw new Error('Open-Meteo: ' + dados.reason);
  return dados;
}

async function _previsao(lat, lon) {
  const chave = _cacheKey('om_prev', lat, lon);
  const agora = Date.now();
  if (_cache[chave] && agora - _cache[chave].ts < CACHE_TTL_MS) return _cache[chave].dados;

  // A temperatura horária dá a hora prevista da mínima de cada dia (alerta de geada).
  const url =
    'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max' +
    ',wind_speed_10m_max,et0_fao_evapotranspiration' +
    '&hourly=temperature_2m' +
    '&timezone=America%2FSao_Paulo&forecast_days=7';

  const dados = await _fetch(url);
  _cache[chave] = { ts: agora, dados };
  return dados;
}

async function _historico(lat, lon) {
  const chave = _cacheKey('om_hist', lat, lon);
  const agora = Date.now();
  if (_cache[chave] && agora - _cache[chave].ts < CACHE_TTL_MS) return _cache[chave].dados;

  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 24 * 60 * 60 * 1000);
  const inicio = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);

  const url =
    'https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&start_date=' + _fmtData(inicio) + '&end_date=' + _fmtData(ontem) +
    '&daily=precipitation_sum&timezone=America%2FSao_Paulo';

  const dados = await _fetch(url);
  _cache[chave] = { ts: agora, dados };
  return dados;
}

function _descricao(precip, prob) {
  if ((precip || 0) >= 10) return 'Chuva';
  if ((precip || 0) >= 2 || (prob || 0) >= 60) return 'Chuvoso';
  if ((prob || 0) >= 30) return 'Nublado';
  return 'Ensolarado';
}

function _icone(precip, prob) {
  if ((precip || 0) >= 10) return '🌧';
  if ((precip || 0) >= 2 || (prob || 0) >= 60) return '🌦';
  if ((prob || 0) >= 30) return '⛅';
  return '☀️';
}

// Hora local ("05:00") da menor temperatura horária prevista no dia; null sem dados horários.
function _horaDaMinima(hourly, dia) {
  const horas = (hourly && hourly.time) || [];
  const temps = (hourly && hourly.temperature_2m) || [];
  let menor = null;
  for (let i = 0; i < horas.length; i++) {
    if (!String(horas[i]).startsWith(dia) || temps[i] == null) continue;
    if (menor === null || temps[i] < temps[menor]) menor = i;
  }
  return menor === null ? null : String(horas[menor]).slice(11, 16);
}

/**
 * Retorna objeto de clima com variáveis agronômicas para o motor de alertas.
 * Combina previsão (7 dias) + histórico (30 dias) para calcular diasSemChuva real.
 */
async function buscarClimaOpenMeteo(lat, lon) {
  const [prevResult, histResult] = await Promise.allSettled([
    _previsao(lat, lon),
    _historico(lat, lon),
  ]);

  if (prevResult.status === 'rejected') throw prevResult.reason;

  const daily = prevResult.value.daily || {};
  const tempsMin = daily.temperature_2m_min || [];
  const tempsMax = daily.temperature_2m_max || [];
  const precip = daily.precipitation_sum || [];
  const precipProb = daily.precipitation_probability_max || [];
  const vento = daily.wind_speed_10m_max || [];
  const evapo = daily.et0_fao_evapotranspiration || [];
  const times = daily.time || [];

  const temperaturaMinima = tempsMin.length > 0
    ? Math.min(...tempsMin.map((v) => (v == null ? 99 : v)))
    : 15;
  const chuvaAcumulada7dias = precip.reduce((s, v) => s + (v == null ? 0 : v), 0);
  const probabilidadeChuva7dias = precipProb.length > 0
    ? Math.max(...precipProb.map((v) => (v == null ? 0 : v)))
    : 0;
  const ventoMaximoKmh = vento.length > 0
    ? Math.max(...vento.map((v) => (v == null ? 0 : v)))
    : 0;
  const evapotranspiracao7dias = evapo.reduce((s, v) => s + (v == null ? 0 : v), 0);

  let diasSemChuva = 0;
  if (histResult.status === 'fulfilled') {
    const precipHist = histResult.value.daily?.precipitation_sum || [];
    // Dias secos consecutivos até ontem (chuva < 1 mm), não o total de dias secos do mês.
    for (let i = precipHist.length - 1; i >= 0 && (precipHist[i] == null ? 0 : precipHist[i]) < 1.0; i--) {
      diasSemChuva++;
    }
  }

  // Temperaturas com uma casa decimal, como temperaturaMinima: o motor de regras
  // usa estes valores para datar a janela de risco (ex.: dias com mínima <= 2 °C).
  const previsaoDiaria = times.slice(0, 7).map((data, i) => ({
    data,
    tempMax: Number((tempsMax[i] == null ? 25 : tempsMax[i]).toFixed(1)),
    tempMin: Number((tempsMin[i] == null ? 15 : tempsMin[i]).toFixed(1)),
    horaMinima: tempsMin[i] == null ? null : _horaDaMinima(prevResult.value.hourly, data),
    chuvaMm: Number(((precip[i] == null ? 0 : precip[i])).toFixed(1)),
    chuvaProbabilidade: precipProb[i] == null ? 0 : precipProb[i],
    ventoMaxKmh: Math.round(vento[i] == null ? 0 : vento[i]),
    descricao: _descricao(precip[i], precipProb[i]),
    icone: _icone(precip[i], precipProb[i]),
  }));

  return {
    temperaturaMinima: Number(temperaturaMinima.toFixed(1)),
    chuvaAcumulada7dias: Number(chuvaAcumulada7dias.toFixed(1)),
    diasSemChuva,
    probabilidadeChuva7dias,
    ventoMaximoKmh: Math.round(ventoMaximoKmh),
    evapotranspiracao7dias: Number(evapotranspiracao7dias.toFixed(1)),
    previsaoDiaria,
    fonte: 'open-meteo',
  };
}

/**
 * Série diária observada/reanalisada em um intervalo arbitrário (YYYY-MM-DD).
 * Usada pelos relatórios para comparar períodos.
 * Retorna [{ data, chuva, tmin, tmax, et0 }].
 */
async function buscarSerieDiaria(lat, lon, inicio, fim) {
  const chave = _cacheKey('om_serie', lat, lon, inicio + '_' + fim);
  const agora = Date.now();
  if (_cache[chave] && agora - _cache[chave].ts < CACHE_TTL_MS) return _cache[chave].dados;

  const url =
    'https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&start_date=' + inicio + '&end_date=' + fim +
    '&daily=precipitation_sum,temperature_2m_min,temperature_2m_max,et0_fao_evapotranspiration' +
    '&timezone=America%2FSao_Paulo';

  const resp = await _fetch(url);
  const d = resp.daily || {};
  const dados = (d.time || []).map((data, i) => ({
    data,
    chuva: d.precipitation_sum ? d.precipitation_sum[i] : null,
    tmin: d.temperature_2m_min ? d.temperature_2m_min[i] : null,
    tmax: d.temperature_2m_max ? d.temperature_2m_max[i] : null,
    et0: d.et0_fao_evapotranspiration ? d.et0_fao_evapotranspiration[i] : null,
  }));
  _cache[chave] = { ts: agora, dados };
  return dados;
}

module.exports = { buscarClimaOpenMeteo, buscarSerieDiaria };
