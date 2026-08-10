/* =====================================================================
   CAMPO — apontamento de obra pelo celular da equipe
   Rodrigues Preventivos

   CAMPO_DEMO = true  -> roda sozinho, sem banco, dados no proprio celular.
                         E o modo do beta, para mostrar e aprovar.
   CAMPO_DEMO = false -> grava em obra_apontamentos no Supabase.
                         So depois de rodar sql/migracao_campo.sql.

   Principio de projeto: o app NUNCA trava o funcionario. Hora e coordenada
   sao sagradas; obra e servico podem ser corrigidos depois no escritorio.
   ===================================================================== */

const CAMPO_DEMO = true;

/* ------------------------------------------------------------- cadastros
   Em producao estes tres vem do banco (equipe, veiculos, obras).
   No beta ficam aqui para a tela rodar sem depender de nada.          */
const EQUIPE = ['Nataniel', 'Beto', 'Pedro', 'Adeilson', 'Marcos', 'Giovani', 'Alexandre'];

const VEICULOS = ['Uno', 'Ducato', 'Iveco', 'Strada', 'Gol', 'Saveiro'];

const SERVICOS = [
  { id: 'HIDRANTE',   rotulo: 'Hidrante',   icone: 'i-agua' },
  { id: 'ALARME',     rotulo: 'Alarme',     icone: 'i-sino' },
  { id: 'SPDA',       rotulo: 'SPDA',       icone: 'i-raio' },
  { id: 'GÁS',        rotulo: 'Gás',        icone: 'i-chama' },
  { id: 'MANUTENÇÃO', rotulo: 'Manutenção', icone: 'i-chave' },
  { id: 'VITAIS',     rotulo: 'Vitais',     icone: 'i-lista' },
];

const OBRAS = [
  'Supermercado Carol', 'Laurentino', 'Supreme Garden', 'Centro Médico Brusque',
  'Casa de Idosos Piçarras', 'Metre Construtora', 'AMP', 'Phinia', 'CCN Academia',
  'Maroma', 'Edifício Barcelona', 'Aston Apartments', 'Conexão Marítima',
  'Salão Igreja Matriz', 'Sardagna', 'Fischer', 'Navepark', 'Willrich',
  'Mega Motos', 'Memorial Brusque',
];

/* ------------------------------------------------------------- estado */
const CHAVE = 'campo.v1';

const vazio = () => ({ eu: null, atual: null, enviados: [], recentes: [] });

function ler() {
  try { return Object.assign(vazio(), JSON.parse(localStorage.getItem(CHAVE) || '{}')); }
  catch { return vazio(); }
}
function gravar() { localStorage.setItem(CHAVE, JSON.stringify(S)); }

let S = ler();
let tela = 'auto';
let rascunho = null;      // seleções da tela de finalização
let gps = { estado: 'parado', sugestao: null, ponto: null };
let cronometro = null;

/* ------------------------------------------------------------ utilitarios */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const icone = (id, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

const hhmm = (iso) => {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

function decorrido(desde) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(desde)) / 60000));
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function porExtenso(d = new Date()) {
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

function obrasSugeridas() {
  const recentes = S.recentes.filter((o) => OBRAS.includes(o));
  return [...recentes, ...OBRAS.filter((o) => !recentes.includes(o))];
}

/* ------------------------------------------------------------------ GPS
   So e chamado nos dois toques (chegada e saida). Nao existe rastreamento
   continuo neste arquivo, e isso e proposital.                          */
function pedirLocalizacao() {
  gps = { estado: 'procurando', sugestao: null, ponto: null };
  render();

  const desiste = setTimeout(() => {
    if (gps.estado === 'procurando') { gps.estado = 'falhou'; render(); }
  }, 7000);

  if (CAMPO_DEMO) {
    setTimeout(() => {
      clearTimeout(desiste);
      gps = {
        estado: 'achou',
        sugestao: 'Supermercado Carol',
        ponto: { lat: -27.097, lon: -48.917, precisao: 12 },
      };
      render();
    }, 1300);
    return;
  }

  if (!navigator.geolocation) { clearTimeout(desiste); gps.estado = 'falhou'; render(); return; }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      clearTimeout(desiste);
      const p = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        precisao: Math.round(pos.coords.accuracy),
      };
      gps = { estado: 'achou', sugestao: obraMaisProxima(p), ponto: p };
      render();
    },
    () => { clearTimeout(desiste); gps = { estado: 'falhou', sugestao: null, ponto: null }; render(); },
    { enableHighAccuracy: true, timeout: 6500, maximumAge: 60000 }
  );
}

/* Distancia em metros (Haversine). Usada para casar o ponto com uma obra. */
function metrosEntre(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

/* Em producao, COORDENADAS vem da tabela obra_coordenadas. */
let COORDENADAS = {};
function obraMaisProxima(p) {
  let melhor = null, menor = 150;   // 150 m: alem disso nao arriscamos sugerir
  for (const [obra, c] of Object.entries(COORDENADAS)) {
    const d = metrosEntre(p, c);
    if (d < menor) { menor = d; melhor = obra; }
  }
  return melhor;
}

/* --------------------------------------------------------------- telas */
function render() {
  const app = document.getElementById('app');
  app.innerHTML = (CAMPO_DEMO ? barraDemo() : '') + topo() + corpo();
  if (cronometro) { clearInterval(cronometro); cronometro = null; }
  if (S.atual?.chegou_em && !rascunho) cronometro = setInterval(render, 30000);
}

function barraDemo() {
  const q = tela === 'quadro';
  return `<div class="barra-demo">
    <span>Versão de demonstração</span>
    <button data-acao="ver-celular" aria-pressed="${!q}">Celular da equipe</button>
    <button data-acao="ver-quadro" aria-pressed="${q}">Quadro do escritório</button>
    <button data-acao="recomecar">Recomeçar</button>
  </div>`;
}

function topo() {
  if (tela === 'quadro') return `<header class="topo"><h1>Rodrigues Preventivos</h1></header>`;
  return `<header class="topo">
    <h1>Apontamento de obra</h1>
    ${S.eu ? `<span class="quem">${esc(S.eu)}</span>` : ''}
  </header>`;
}

function corpo() {
  if (tela === 'quadro') return telaQuadro();
  if (!S.eu) return telaQuem();
  if (tela === 'pronto') return telaPronto();
  if (tela === 'obra') return telaObra();
  if (rascunho) return telaFinalizar();
  return telaInicio();
}

/* 1 - quem e voce (uma vez so) */
function telaQuem() {
  return `<main class="tela">
    <h2>Quem é você?</h2>
    <p class="sub">Só nesta primeira vez. Depois o celular já lembra.</p>
    ${EQUIPE.map((n) => `
      <button class="botao" data-acao="sou-eu" data-valor="${esc(n)}">${esc(n)}</button>`).join('')}
  </main>`;
}

/* 2 - inicio: patio, a caminho ou em obra */
function telaInicio() {
  const a = S.atual;
  const agora = new Date();
  const relogio = `<div class="relogio">
    <div class="hora">${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}</div>
    <div class="dia">${porExtenso(agora)}</div>
  </div>`;

  if (!a) {
    return `<main class="tela">
      ${relogio}
      <button class="botao gigante verde" data-acao="chegar-agora">
        ${icone('i-pino')} Cheguei na obra
      </button>
      <button class="botao" data-acao="vou-para">
        ${icone('i-volante')}
        <span>Estou saindo para uma obra
          <span class="obs">toque aqui ainda no pátio</span>
        </span>
      </button>
    </main>`;
  }

  if (!a.chegou_em) {
    return `<main class="tela">
      <div class="faixa cinza">
        <div class="titulo">A caminho de ${esc(a.obra)}</div>
        <div class="desde">saiu do pátio às ${hhmm(a.saiu_patio_em)}</div>
      </div>
      <button class="botao gigante verde" data-acao="cheguei">
        ${icone('i-pino')} Cheguei
      </button>
      <button class="botao tracejado" data-acao="trocar-obra">Mudou de obra? Trocar</button>
    </main>`;
  }

  return `<main class="tela">
    <div class="faixa">
      <div class="titulo">${esc(a.obra)}</div>
      <div class="desde">desde as ${hhmm(a.chegou_em)} · ${decorrido(a.chegou_em)} trabalhando</div>
    </div>
    <button class="botao gigante vermelho" data-acao="terminei">
      ${icone('i-bandeira')} Terminei
    </button>
  </main>`;
}

/* 3 - escolher a obra (GPS -> recentes -> ditar) */
function telaObra() {
  let faixaGps = '';
  if (gps.estado === 'procurando') {
    faixaGps = `<div class="aviso-gps">${icone('i-pino')} Procurando onde você está…</div>`;
  } else if (gps.estado === 'achou' && gps.sugestao) {
    faixaGps = `<button class="botao" aria-pressed="true" data-acao="escolher-obra"
        data-valor="${esc(gps.sugestao)}" data-origem="gps">
      ${icone('i-pino')}
      <span>${esc(gps.sugestao)}<span class="obs">o GPS indica que você está aqui</span></span>
      <span class="marca-check">✓</span>
    </button>`;
  } else if (gps.estado === 'falhou') {
    faixaGps = `<div class="aviso-gps">${icone('i-info')}
      O GPS não pegou. Escolha na lista abaixo — não tem problema.</div>`;
  }

  const lista = obrasSugeridas()
    .filter((o) => o !== gps.sugestao)
    .map((o) => `<button class="botao" data-acao="escolher-obra" data-valor="${esc(o)}"
        data-origem="recente">${esc(o)}</button>`).join('');

  return `<main class="tela">
    <button class="voltar" data-acao="inicio">${icone('i-voltar')} Voltar</button>
    <h2>Em que obra você está?</h2>
    <p class="sub">Se não achar na lista, fale o nome no fim da página.</p>
    ${faixaGps}
    ${lista}
    <button class="botao tracejado" data-acao="ditar-obra">
      ${icone('i-microfone')} Falar o nome de outra obra
    </button>
    <button class="botao tracejado" data-acao="sem-obra">
      Não sei o nome — apontar mesmo assim
    </button>
  </main>`;
}

/* 4 - finalizacao em quatro passos */
function telaFinalizar() {
  const p = rascunho.passo;
  if (p === 'servico')  return passoServico();
  if (p === 'veiculo')  return passoVeiculo();
  if (p === 'equipe')   return passoEquipe();
  return passoObs();
}

function passoServico() {
  return `<main class="tela">
    <h2>O que vocês fizeram?</h2>
    <p class="sub">Pode marcar mais de um.</p>
    <div class="grade2">
      ${SERVICOS.map((s) => `
        <button class="botao" data-acao="alternar-servico" data-valor="${esc(s.id)}"
          aria-pressed="${rascunho.servicos.includes(s.id)}">
          <span class="marca-check">✓</span>
          ${icone(s.icone)}
          <span>${esc(s.rotulo)}</span>
        </button>`).join('')}
    </div>
    <div class="avancar">
      <button class="botao gigante escuro" data-acao="passo" data-valor="veiculo">Continuar</button>
    </div>
  </main>`;
}

function passoVeiculo() {
  return `<main class="tela">
    <button class="voltar" data-acao="passo" data-valor="servico">${icone('i-voltar')} Voltar</button>
    <h2>Qual carro vocês usaram?</h2>
    <div class="grade2">
      ${VEICULOS.map((v) => `
        <button class="botao" data-acao="escolher-veiculo" data-valor="${esc(v)}"
          aria-pressed="${rascunho.veiculo === v}">
          <span class="marca-check">✓</span>
          ${icone('i-volante')}
          <span>${esc(v)}</span>
        </button>`).join('')}
    </div>
    <div class="avancar">
      <button class="botao gigante escuro" data-acao="passo" data-valor="equipe">Continuar</button>
    </div>
  </main>`;
}

function passoEquipe() {
  return `<main class="tela">
    <button class="voltar" data-acao="passo" data-valor="veiculo">${icone('i-voltar')} Voltar</button>
    <h2>Quem estava com você?</h2>
    <p class="sub">Já marcamos quem foi da última vez. Desmarque quem não veio.</p>
    ${EQUIPE.map((n) => `
      <button class="botao" data-acao="alternar-colega" data-valor="${esc(n)}"
        aria-pressed="${rascunho.equipe.includes(n)}">
        ${esc(n)}${n === S.eu ? '<span class="obs">você</span>' : ''}
        <span class="marca-check">✓</span>
      </button>`).join('')}
    <div class="avancar">
      <button class="botao gigante escuro" data-acao="passo" data-valor="obs">Continuar</button>
    </div>
  </main>`;
}

function passoObs() {
  return `<main class="tela">
    <button class="voltar" data-acao="passo" data-valor="equipe">${icone('i-voltar')} Voltar</button>
    <h2>Quer falar alguma coisa?</h2>
    <p class="sub">Material usado, o que ficou pendente, qualquer recado.</p>
    <button class="botao gigante escuro" data-acao="falar" style="margin-bottom:12px">
      ${icone('i-microfone')} Falar
    </button>
    <textarea id="obs" placeholder="Ou escreva aqui">${esc(rascunho.obs)}</textarea>
    <p class="dica">Dica: o teclado do celular também tem um microfone.</p>
    <div class="avancar">
      <button class="botao gigante escuro" data-acao="enviar">
        ${icone('i-enviar')} Enviar
      </button>
    </div>
  </main>`;
}

function telaPronto() {
  return `<main class="fim">
    ${icone('i-ok')}
    <h2>Enviado</h2>
    <p>O escritório já está vendo.</p>
    <div class="tela" style="padding-top:26px">
      <button class="botao gigante escuro" data-acao="inicio">Voltar ao início</button>
    </div>
  </main>`;
}

/* 5 - quadro do escritorio */
function telaQuadro() {
  const abertos = [];
  if (S.atual) {
    abertos.push({
      obra: S.atual.obra || 'obra não informada',
      equipe: S.atual.equipe?.length ? S.atual.equipe : [S.eu],
      veiculo: S.atual.veiculo,
      desde: S.atual.chegou_em || S.atual.saiu_patio_em,
      situacao: S.atual.chegou_em ? 'em_obra' : 'a_caminho',
    });
  }
  if (CAMPO_DEMO) abertos.push(...quadroExemplo());

  const linhas = abertos.map((e) => `
    <div class="linha-equipe ${e.situacao === 'em_obra' ? 'em-obra' : 'a-caminho'}">
      ${icone(e.situacao === 'em_obra' ? 'i-pino' : 'i-volante')}
      <div class="corpo">
        <div class="obra">${esc(e.obra)}</div>
        <div class="gente">${esc(e.equipe.join(', '))}${e.veiculo ? ' · ' + esc(e.veiculo) : ''}</div>
      </div>
      <div class="tempo">
        ${e.situacao === 'em_obra'
          ? `<b>${decorrido(e.desde)}</b><span>desde ${hhmm(e.desde)}</span>`
          : `<b style="font-size:15px;font-weight:400">a caminho</b><span>saiu ${hhmm(e.desde)}</span>`}
      </div>
    </div>`).join('');

  const horas = abertos
    .filter((e) => e.situacao === 'em_obra')
    .reduce((t, e) => t + (Date.now() - new Date(e.desde)) / 3600000, 0);

  const emObra = abertos.filter((e) => e.situacao === 'em_obra')
    .reduce((t, e) => t + e.equipe.length, 0);

  return `<main class="quadro">
    <div class="quadro-topo">
      <h2>Equipes em campo</h2>
      <span class="agora">${porExtenso()} · ${hhmm(new Date().toISOString())}</span>
    </div>
    ${linhas || '<div class="linha-equipe"><div class="corpo"><div class="gente">Ninguém apontou ainda hoje.</div></div></div>'}
    ${CAMPO_DEMO ? `
      <div class="linha-equipe alerta">
        ${icone('i-alerta')}
        <div class="corpo">
          <div class="obra">Sem apontamento hoje</div>
          <div class="gente">Valdir · última vez sexta, 07/08</div>
        </div>
      </div>
      <p class="secao">Resolver depois</p>
      <div class="linha-equipe pendente">
        ${icone('i-info')}
        <div class="corpo">
          <div class="obra">1 apontamento sem obra</div>
          <div class="gente">Marcos · ontem 13:20 às 16:05 · tem coordenada</div>
        </div>
      </div>` : ''}
    <div class="totais">
      <div><span>em obra agora</span><b>${emObra}</b></div>
      <div><span>obras ativas</span><b>${new Set(abertos.filter((e) => e.situacao === 'em_obra').map((e) => e.obra)).size}</b></div>
      <div><span>horas em curso</span><b>${horas.toFixed(1).replace('.', ',')}h</b></div>
    </div>
  </main>`;
}

function quadroExemplo() {
  const hoje = new Date();
  const as = (h, m) => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), h, m).toISOString();
  return [
    { obra: 'Laurentino', equipe: ['Pedro', 'Adeilson'], veiculo: 'Strada', desde: as(7, 30), situacao: 'em_obra' },
    { obra: 'Phinia', equipe: ['Beto', 'Giovani'], veiculo: 'Uno', desde: as(9, 20), situacao: 'a_caminho' },
  ];
}

/* --------------------------------------------------------------- acoes */
document.addEventListener('click', (ev) => {
  const alvo = ev.target.closest('[data-acao]');
  if (!alvo) return;
  const { acao, valor, origem } = alvo.dataset;
  guardarObs();

  const acoes = {
    'recomecar':   () => { localStorage.removeItem(CHAVE); S = vazio(); rascunho = null; tela = 'auto'; },
    'ver-celular': () => { tela = 'auto'; },
    'ver-quadro':  () => { tela = 'quadro'; },
    'inicio':      () => { tela = 'auto'; rascunho = null; },

    'sou-eu': () => { S.eu = valor; gravar(); },

    'vou-para':     () => { rascunho = null; modoObra = 'saindo';   tela = 'obra'; pedirLocalizacao(); },
    'chegar-agora': () => { rascunho = null; modoObra = 'chegando'; tela = 'obra'; pedirLocalizacao(); },
    'trocar-obra':  () => { modoObra = 'trocando'; tela = 'obra'; pedirLocalizacao(); },

    'escolher-obra': () => confirmarObra(valor, origem),
    'sem-obra':      () => confirmarObra(null, 'nao_informada'),
    'ditar-obra':    () => ouvir((texto) => confirmarObra(texto, 'digitada')),

    'cheguei': () => {
      S.atual.chegou_em = new Date().toISOString();
      if (gps.ponto) Object.assign(S.atual, {
        lat_chegada: gps.ponto.lat, lon_chegada: gps.ponto.lon,
        precisao_chegada: gps.ponto.precisao,
      });
      gravar();
      tela = 'auto';
    },

    'terminei': () => {
      S.atual.terminou_em = new Date().toISOString();
      gravar();
      rascunho = {
        passo: 'servico',
        servicos: [],
        veiculo: S.atual.veiculo || null,
        equipe: S.atual.equipe?.length ? [...S.atual.equipe] : [S.eu],
        obs: '',
      };
    },

    'passo':             () => { rascunho.passo = valor; },
    'alternar-servico':  () => alternar(rascunho.servicos, valor),
    'alternar-colega':   () => alternar(rascunho.equipe, valor),
    'escolher-veiculo':  () => { rascunho.veiculo = valor; },
    'falar':             () => ouvir((t) => { rascunho.obs = (rascunho.obs + ' ' + t).trim(); }),
    'enviar':            () => enviar(),
  };

  if (acoes[acao]) { acoes[acao](); render(); }
});

function alternar(lista, valor) {
  const i = lista.indexOf(valor);
  if (i < 0) lista.push(valor); else lista.splice(i, 1);
}

function guardarObs() {
  const t = document.getElementById('obs');
  if (t && rascunho) rascunho.obs = t.value;
}

/* Qual botao abriu a tela de obra: decide se ja e chegada ou so saida do patio. */
let modoObra = null;

function confirmarObra(obra, origem) {
  const agora = new Date().toISOString();

  S.atual = Object.assign(S.atual || {}, {
    obra, origem_obra: origem,
    saiu_patio_em: S.atual?.saiu_patio_em || agora,
  });

  // "Cheguei na obra" ja marca a chegada; "estou saindo" so marca a saida do patio.
  if (modoObra === 'chegando') {
    S.atual.chegou_em = agora;
    if (gps.ponto) Object.assign(S.atual, {
      lat_chegada: gps.ponto.lat, lon_chegada: gps.ponto.lon,
      precisao_chegada: gps.ponto.precisao,
    });
  }

  if (obra) {
    S.recentes = [obra, ...S.recentes.filter((o) => o !== obra)].slice(0, 6);
    if (gps.ponto && !CAMPO_DEMO) COORDENADAS[obra] = { lat: gps.ponto.lat, lon: gps.ponto.lon };
  }
  gravar();
  modoObra = null;
  tela = 'auto';
}

/* Ditado: usa o reconhecimento do navegador quando existe; se nao,
   manda o funcionario para o teclado, que tem microfone proprio. */
function ouvir(aoTerminar) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) {
    const t = document.getElementById('obs');
    if (t) { t.focus(); return; }
    const texto = prompt('Fale usando o microfone do teclado, ou escreva:');
    if (texto) { aoTerminar(texto); render(); }
    return;
  }
  const r = new Rec();
  r.lang = 'pt-BR';
  r.interimResults = false;
  r.onresult = (e) => { aoTerminar(e.results[0][0].transcript); render(); };
  r.onerror = () => { const t = document.getElementById('obs'); if (t) t.focus(); };
  r.start();
}

/* ------------------------------------------------------------- gravacao */
async function enviar() {
  guardarObs();
  const a = S.atual, r = rascunho;

  const registro = {
    obra_texto: a.obra,
    origem_obra: a.origem_obra || 'nao_informada',
    data: new Date().toISOString().slice(0, 10),
    saiu_patio_em: a.saiu_patio_em || null,
    chegou_em: a.chegou_em || null,
    terminou_em: a.terminou_em || new Date().toISOString(),
    equipe: r.equipe,
    veiculo: r.veiculo,
    servicos: r.servicos,
    observacoes: r.obs || null,
    lat_chegada: a.lat_chegada ?? null,
    lon_chegada: a.lon_chegada ?? null,
    precisao_chegada: a.precisao_chegada ?? null,
    apontado_por_nome: S.eu,
  };

  S.enviados.unshift(registro);
  S.atual = null;
  rascunho = null;
  gravar();
  tela = 'pronto';

  if (!CAMPO_DEMO) {
    try { await gravarNoSupabase(registro); }
    catch { /* fica na fila em S.enviados e sobe depois */ }
  }
}

/* Producao. So roda com CAMPO_DEMO = false e apos a migracao_campo.sql. */
async function gravarNoSupabase(registro) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(window.CAMPO_URL, window.CAMPO_ANON);
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('obra_apontamentos')
    .insert({ ...registro, apontado_por: user?.id ?? null });
  if (error) throw error;
}

/* ------------------------------------------------------------------ boot */
if (new URLSearchParams(location.search).has('quadro')) tela = 'quadro';
render();
