/* =====================================================================
   PAINEL DE OBRAS — Rodrigues Preventivos
   App único em JS puro + Supabase (auth, banco, storage).
   ===================================================================== */

/* ---------- catálogos ---------- */
const SERVICOS = {
  SHP:           { label:'Hidrantes (SHP)' },
  SPDA:          { label:'Para-raios (SPDA)' },
  VITAIS:        { label:'Vitais (extintor/placa/iluminação)' },
  SDAI:          { label:'Alarme de incêndio (SDAI)' },
  GLP:           { label:'Gás (GLP)' },
  AR_COMPRIMIDO: { label:'Ar comprimido / gás medicinal' },
  MANUT_SHP:     { label:'Manutenção SHP' },
  MANUT_SKID:    { label:'Manutenção Skid de bombas' },
  MANUT_ALARME:  { label:'Manutenção Alarme' },
};
const SKILL_DE_SERVICO = { SHP:'SHP', MANUT_SHP:'SHP', SPDA:'SPDA', SDAI:'SDAI',
  MANUT_ALARME:'SDAI', VITAIS:'VITAIS', GLP:'GAS', AR_COMPRIMIDO:'GAS', MANUT_SKID:'SKID' };
const FRONT_DE_SERVICO = { SHP:'hidraulica', MANUT_SHP:'hidraulica', MANUT_SKID:'hidraulica',
  SPDA:'spda', SDAI:'alarme_vitais', MANUT_ALARME:'alarme_vitais', VITAIS:'alarme_vitais',
  GLP:'gas', AR_COMPRIMIDO:'gas' };
const TAMANHO_FRENTE = { hidraulica:3, alarme_vitais:2, spda:2, gas:2 };

const STATUS = {
  em_andamento:      { label:'Em andamento' },
  pendente_material: { label:'Pendente material' },
  pendente_execucao: { label:'Pendente execução' },
  concluida:         { label:'100% concluída' },
};
const COBRANCA = {
  nao_aplicavel:    'Não aplicável',
  a_cobrar:         'A cobrar',
  cobranca_enviada: 'Cobrança enviada',
  pago:             'Pago',
};

/* ---------- estado ---------- */
let sb = null;
const state = {
  user:null, perfil:null, isAdmin:false, isComercial:false,
  obras:[], equipe:[], financeiro:{}, monitor:[], orcamentos:[], orcErro:null,
  renovacoes:[], renovErro:null, buscaRenov:'', fRenovDias:'', fRenovStatus:'', fRenovEmail:'',
  modulo:'obras', aba:'obras', filtroStatus:'ativas', filtroCob:'pendentes', busca:'',
  abaOrc:'pendente', filtroOrc:'todos', buscaOrc:'',
  modalAberto:false,
};

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function toast(msg, erro){ const t=$('#toast'); t.textContent=msg; t.className='toast'+(erro?' erro-toast':''); setTimeout(()=>t.classList.add('hidden'),3200); }
function dataBR(d){ if(!d) return '—'; const x=new Date(d.length<=10?d+'T00:00:00':d); return x.toLocaleDateString('pt-BR'); }
function moeda(v){ return v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function soDigitos(t){ return (t||'').replace(/\D/g,''); }
function waLink(tel, texto){ let d=soDigitos(tel); if(!d) return null; if(d.length<=11) d='55'+d; return `https://wa.me/${d}?text=${encodeURIComponent(texto||'')}`; }
function abrirModal(html){ $('#modal-conteudo').innerHTML=html; $('#modal-fundo').classList.remove('hidden'); state.modalAberto=true; }
function fecharModal(){ $('#modal-fundo').classList.add('hidden'); $('#modal-conteudo').innerHTML=''; state.modalAberto=false; }

function diasRestantes(o){ if(!o.data_prazo) return null; const h=new Date(); h.setHours(0,0,0,0);
  return Math.round((new Date(o.data_prazo+'T00:00:00')-h)/86400000); }
function urg(dias, status){ if(status==='concluida'||dias==null) return 'cinza';
  if(dias<=2) return 'vermelho'; if(dias<=5) return 'ambar'; return 'verde'; }
function textoDias(dias){ if(dias==null) return 'sem prazo'; if(dias<0) return `atrasada ${-dias}d`;
  if(dias===0) return 'vence hoje'; if(dias===1) return 'falta 1 dia'; return `faltam ${dias} dias`; }

/* =====================================================================
   MOTOR DE SUGESTÃO DE EQUIPE
   ===================================================================== */
function scoreSkill(p, skill){
  const ip=p.principais.indexOf(skill); if(ip>=0) return ip*10+p.principais.length;
  const ih=p.habilidades.indexOf(skill); if(ih>=0) return 100+ih*10+p.habilidades.length;
  return 9999;
}
function sugerirEquipe(servicos, temSkid){
  const ativos = state.equipe.filter(e=>e.ativo);
  const fixos  = ativos.filter(e=>!e.coringa && !e.parceiro);
  const fronts = [...new Set(servicos.map(s=>FRONT_DE_SERVICO[s]).filter(Boolean))];
  const skills = [...new Set(servicos.map(s=>SKILL_DE_SERVICO[s]).filter(s=>s && s!=='SKID'))];
  const escolhidos=[]; const notas=[];
  const tem = n => escolhidos.includes(n);

  // 1) 1 especialista por skill necessária
  for(const sk of skills){
    const cand = fixos.filter(e=>(e.principais.includes(sk)||e.habilidades.includes(sk)) && !tem(e.nome))
      .sort((a,b)=> scoreSkill(a,sk)-scoreSkill(b,sk) || a.nome.localeCompare(b.nome));
    if(cand[0]) escolhidos.push(cand[0].nome);
  }
  // 2) tamanho-alvo = maior frente envolvida
  const alvo = fronts.length ? Math.max(...fronts.map(f=>TAMANHO_FRENTE[f]||2)) : escolhidos.length;
  // 3) completa o time: primeiro o AJUDANTE (preferência da empresa — não
  //    "gastar" um 2º especialista num time que já tem um por frente),
  //    e só depois mais gente capaz das skills.
  if(escolhidos.length < alvo){
    const ajud = fixos.filter(e=>e.principais.includes('AJUDANTE') && !tem(e.nome));
    for(const a of ajud){ if(escolhidos.length>=alvo) break; escolhidos.push(a.nome); }
    for(const sk of skills){
      if(escolhidos.length>=alvo) break;
      const mais = fixos.filter(e=>(e.principais.includes(sk)||e.habilidades.includes(sk)) && !tem(e.nome))
        .sort((a,b)=> scoreSkill(a,sk)-scoreSkill(b,sk) || a.nome.localeCompare(b.nome));
      for(const m of mais){ if(escolhidos.length>=alvo) break; escolhidos.push(m.nome); }
    }
  }
  // 4) skid
  if(temSkid){
    const skidGente = fixos.filter(e=>e.habilidades.includes('SKID')).map(e=>e.nome);
    const parc = ativos.filter(e=>e.parceiro).map(e=>e.nome);
    notas.push({tipo:'skid', texto:`Skid de bombas — fabricar com ${skidGente.join(' + ')||'Pedro + Adeilson'} (base, conexões e motores conosco). Painel elétrico e start-up: ${parc.join(', ')||'Wagner'} (parceiro).`});
  }
  // 5) coringa p/ alarme/vitais
  if(fronts.includes('alarme_vitais')){
    const cor = ativos.filter(e=>e.coringa).map(e=>e.nome);
    if(cor.length) notas.push({tipo:'coringa', texto:`Reforço opcional de alarme/vitais: ${cor.join(', ')} (coringa — acerto por fora). Use se as equipes fixas estiverem cheias.`});
  }
  return { equipe:escolhidos, notas };
}

/* =====================================================================
   AUTENTICAÇÃO
   ===================================================================== */
async function iniciar(){
  const cfg = window.PAINEL_CONFIG||{};
  if(!cfg.SUPABASE_URL || cfg.SUPABASE_URL.startsWith('COLE_AQUI')){
    $('#tela-config').classList.remove('hidden'); return;
  }
  sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const { data:{ session } } = await sb.auth.getSession();
  if(session) await aposLogin(session.user); else $('#tela-login').classList.remove('hidden');

  // Só reage ao logout EXPLÍCITO. Não reagir ao evento inicial "sem sessão",
  // senão a tela de login entra em loop de reload (F5 sem parar).
  sb.auth.onAuthStateChange((evento)=>{ if(evento === 'SIGNED_OUT'){ location.reload(); } });
}

async function aposLogin(user){
  state.user = user;
  const { data:perfil } = await sb.from('perfis').select('*').eq('id', user.id).single();
  state.perfil = perfil; state.isAdmin = perfil?.papel === 'admin';
  // Comercial = admin OU quem tem "vendedor" no perfil (Aline, Banana, Guilherme).
  state.isComercial = state.isAdmin || !!perfil?.vendedor;
  $('#tela-login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-nome').textContent = perfil?.nome || user.email;
  const pb = $('#user-papel'); pb.textContent = state.isAdmin?'admin':(perfil?.vendedor?'comercial':'operação');
  pb.classList.toggle('admin', state.isAdmin);
  document.querySelectorAll('.so-admin').forEach(el=>el.classList.toggle('hidden', !state.isAdmin));
  // módulos visíveis por papel:
  //  admin     -> tudo  ·  comercial (vendedor) -> Orçamentos + Leads  ·  operação -> Obras
  let permitidos;
  if(state.isAdmin) permitidos = ['obras','orcamentos','leads','monitor','renovacoes'];
  else if(perfil?.vendedor) permitidos = ['orcamentos','leads'];
  else permitidos = ['obras'];
  document.querySelectorAll('.modulo').forEach(b=> b.classList.toggle('hidden', !permitidos.includes(b.dataset.mod)));
  if(!permitidos.includes(state.modulo)) trocarModulo(permitidos[0]);
  await carregarTudo();
  setInterval(()=>{ if(!state.modalAberto) carregarTudo(true); }, 60000);
}

$('#form-login').addEventListener('submit', async e=>{
  e.preventDefault(); $('#login-erro').textContent='';
  const btn=$('#btn-entrar'); btn.disabled=true; btn.textContent='Entrando…';
  const { data, error } = await sb.auth.signInWithPassword({ email:$('#login-email').value.trim(), password:$('#login-senha').value });
  btn.disabled=false; btn.textContent='Entrar';
  if(error){ $('#login-erro').textContent = error.message==='Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message; return; }
  await aposLogin(data.user);
});
$('#btn-sair').addEventListener('click', async ()=>{ await sb.auth.signOut(); location.reload(); });
$('#btn-senha').addEventListener('click', ()=>modalSenha());

function modalSenha(){
  abrirModal(`<h2>Trocar minha senha</h2>
    <p class="det-sub">Defina uma nova senha (mínimo 6 caracteres). Vale só para o seu login (${esc(state.perfil?.nome||state.user?.email||'')}).</p>
    <label class="campo" style="margin-bottom:10px">Nova senha<input type="password" id="sn1" autocomplete="new-password" style="width:100%"></label>
    <label class="campo">Confirmar nova senha<input type="password" id="sn2" autocomplete="new-password" style="width:100%"></label>
    <div id="sn-erro" class="erro" style="margin-top:8px"></div>
    <div class="form-acoes"><button class="btn btn-ghost" id="sn-cancel">Cancelar</button><button class="btn btn-primary" id="sn-salva">Salvar nova senha</button></div>`);
  $('#sn-cancel').onclick=fecharModal;
  $('#sn-salva').onclick=async()=>{
    const a=$('#sn1').value, b=$('#sn2').value, err=$('#sn-erro');
    if(a.length<6){ err.textContent='A senha precisa de pelo menos 6 caracteres.'; return; }
    if(a!==b){ err.textContent='As senhas não conferem.'; return; }
    const btn=$('#sn-salva'); btn.disabled=true; btn.textContent='Salvando…';
    const { error }=await sb.auth.updateUser({ password:a });
    btn.disabled=false; btn.textContent='Salvar nova senha';
    if(error){ err.textContent=error.message; return; }
    fecharModal(); toast('Senha alterada com sucesso! ✓');
  };
}

/* =====================================================================
   CARGA DE DADOS
   ===================================================================== */
async function carregarTudo(silencioso){
  const { data:obras, error } = await sb.from('obras')
    .select('*, obra_servicos(*), obra_itens(*)').order('criado_em',{ascending:false});
  if(error){ if(!silencioso) toast('Erro ao carregar obras: '+error.message, true); return; }
  state.obras = obras||[];
  const { data:eq } = await sb.from('equipe').select('*').order('nome');
  state.equipe = eq||[];
  if(state.isAdmin){
    const { data:fin } = await sb.from('obra_financeiro').select('*');
    state.financeiro = {}; (fin||[]).forEach(f=> state.financeiro[f.obra_id]=f);
  }
  if(state.isComercial){
    const { data:orc, error:eo } = await sb.from('orcamentos')
      .select('*, orcamento_itens(*)').order('criado_em',{ascending:false});
    if(eo){ state.orcErro = eo.message; state.orcamentos = []; }
    else { state.orcErro = null; state.orcamentos = orc||[]; }
  }
  if(state.isAdmin){
    const { data:rv, error:er } = await sb.from('renovacoes')
      .select('*').order('vencimento',{ascending:true, nullsFirst:false});
    if(er){ state.renovErro = er.message; state.renovacoes = []; }
    else { state.renovErro = null; state.renovacoes = rv||[]; }
  }
  render();
}

/* =====================================================================
   MÓDULOS DO PORTAL (Obras, Leads, ...)
   ===================================================================== */
const LEADS_URL = 'https://addsonthoma.github.io/rodrigues-painel/qbQv3yHGdx6ocaYE/';
function trocarModulo(mod){
  state.modulo = mod;
  document.querySelectorAll('.modulo').forEach(b=> b.classList.toggle('ativa', b.dataset.mod===mod));
  document.getElementById('mod-obras').classList.toggle('hidden', mod!=='obras');
  document.getElementById('mod-orcamentos').classList.toggle('hidden', mod!=='orcamentos');
  document.getElementById('mod-leads').classList.toggle('hidden', mod!=='leads');
  document.getElementById('mod-monitor').classList.toggle('hidden', mod!=='monitor');
  document.getElementById('mod-renovacoes').classList.toggle('hidden', mod!=='renovacoes');
  if(mod==='leads'){ const fr=document.getElementById('leads-frame'); if(!fr.getAttribute('src')) fr.src=LEADS_URL+'?v='+Date.now(); }
  if(mod==='monitor') carregarMonitor();
  if(mod==='orcamentos') renderOrcamentos();
  if(mod==='renovacoes') renderRenovacoes();
}
$('#modulos').addEventListener('click', e=>{ const b=e.target.closest('.modulo'); if(b) trocarModulo(b.dataset.mod); });

/* =====================================================================
   NAVEGAÇÃO ENTRE ABAS
   ===================================================================== */
$('#abas').addEventListener('click', e=>{
  const b=e.target.closest('.aba'); if(!b) return;
  state.aba=b.dataset.aba;
  document.querySelectorAll('.aba').forEach(a=>a.classList.toggle('ativa', a===b));
  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
  $('#view-'+state.aba).classList.remove('hidden');
  render();
});
$('#busca-obras').addEventListener('input', e=>{ state.busca=e.target.value.toLowerCase(); renderObras(); });
$('#modal-fechar').addEventListener('click', fecharModal);
$('#modal-fundo').addEventListener('click', e=>{ if(e.target.id==='modal-fundo') fecharModal(); });

/* =====================================================================
   RENDER
   ===================================================================== */
function render(){ renderContadores(); renderFiltros(); renderObras(); renderPendencias(); if(state.isAdmin){ renderCobrancas(); renderEquipe(); renderRenovacoes(); } if(state.isComercial) renderOrcamentos(); }

function renderContadores(){
  const pend = state.obras.filter(o=>o.status_execucao==='pendente_material').length;
  $('#num-pend').textContent = pend||'';
  if(state.isAdmin){
    const cob = state.obras.filter(o=>{ const f=state.financeiro[o.id]; return f && (f.status_cobranca==='a_cobrar'||f.status_cobranca==='cobranca_enviada'); }).length;
    $('#num-cob').textContent = cob||'';
  }
}

function renderFiltros(){
  const def=[['ativas','Ativas'],['em_andamento','Em andamento'],['pendente_material','Pend. material'],['pendente_execucao','Pend. execução'],['concluida','Concluídas'],['todas','Todas']];
  $('#filtros-status').innerHTML = def.map(([k,l])=>`<button class="chip-filtro ${state.filtroStatus===k?'ativo':''}" data-f="${k}">${l}</button>`).join('');
  $('#filtros-status').querySelectorAll('.chip-filtro').forEach(c=>c.onclick=()=>{state.filtroStatus=c.dataset.f; renderFiltros(); renderObras();});
  if(state.isAdmin){
    const dc=[['pendentes','A cobrar + enviadas'],['a_cobrar','A cobrar'],['cobranca_enviada','Enviadas'],['pago','Pagas'],['todas','Todas']];
    $('#filtros-cobranca').innerHTML = dc.map(([k,l])=>`<button class="chip-filtro ${state.filtroCob===k?'ativo':''}" data-f="${k}">${l}</button>`).join('');
    $('#filtros-cobranca').querySelectorAll('.chip-filtro').forEach(c=>c.onclick=()=>{state.filtroCob=c.dataset.f; renderFiltros(); renderCobrancas();});
  }
}

function ordenarUrgencia(arr){
  return arr.slice().sort((a,b)=>{
    const da=diasRestantes(a), db=diasRestantes(b);
    if(da==null&&db==null) return 0; if(da==null) return 1; if(db==null) return -1; return da-db;
  });
}

function cardObra(o){
  const dias=diasRestantes(o), u=urg(dias,o.status_execucao);
  const servs=(o.obra_servicos||[]).map(s=>`<span class="chip-serv ${s.servico}">${esc(SERVICOS[s.servico]?.label||s.servico)}</span>`).join('');
  const equipe=(o.equipe_confirmada?.length?o.equipe_confirmada:o.equipe_sugerida)||[];
  const eqTxt = equipe.length ? `${o.equipe_confirmada?.length?'<b>Equipe:</b>':'<b>Sugerida:</b>'} ${esc(equipe.join(', '))}` : '<span style="opacity:.6">sem equipe definida</span>';
  const fin = state.financeiro[o.id];
  const cob = fin && fin.status_cobranca!=='nao_aplicavel' ? `<span class="cob-badge cob-${fin.status_cobranca}">${COBRANCA[fin.status_cobranca]}</span>` : '';
  return `<div class="card-obra urg-${u}" data-id="${o.id}">
    <div class="card-topo">
      <div><div class="card-cliente">${esc(o.cliente)}</div>
        ${o.endereco?`<div class="card-end">${esc(o.endereco)}</div>`:''}
        ${o.orcamento_qs?`<div class="card-or">Orç. ${esc(o.orcamento_qs)}</div>`:''}</div>
      <span class="status-badge st-${o.status_execucao}">${STATUS[o.status_execucao].label}</span>
    </div>
    <div class="servicos-chips">${servs||'<span class="card-end">sem serviço</span>'}</div>
    <div class="card-prazo">⏱ <span class="dias urg-${u}">${textoDias(dias)}</span>
      ${o.data_prazo?`<small>até ${dataBR(o.data_prazo)}</small>`:''} ${o.tem_skid?'<span class="chip-serv">SKID</span>':''}</div>
    <div class="card-equipe">${eqTxt}</div>
    <div class="card-rodape">
      <button class="btn btn-sec btn-sm js-materiais" data-id="${o.id}">🖨 Materiais</button>
      ${cob}
    </div>
  </div>`;
}

function renderObras(){
  let arr=state.obras;
  if(state.filtroStatus==='ativas') arr=arr.filter(o=>o.status_execucao!=='concluida');
  else if(state.filtroStatus!=='todas') arr=arr.filter(o=>o.status_execucao===state.filtroStatus);
  if(state.busca){ arr=arr.filter(o=> (o.cliente+' '+(o.endereco||'')+' '+(o.orcamento_qs||'')).toLowerCase().includes(state.busca)); }
  arr=ordenarUrgencia(arr);
  $('#lista-obras').innerHTML = arr.map(cardObra).join('');
  $('#obras-vazio').classList.toggle('hidden', arr.length>0);
  ligarCards('#lista-obras');
}

function renderPendencias(){
  const arr=ordenarUrgencia(state.obras.filter(o=>o.status_execucao==='pendente_material'));
  $('#lista-pendencias').innerHTML = arr.map(o=>{
    const c=cardObra(o);
    const obs=o.pendencia_obs?`<div class="nota">📦 ${esc(o.pendencia_obs)}</div>`:'';
    return c.replace('</div>\n    <div class="card-rodape">', obs+'</div>\n    <div class="card-rodape">');
  }).join('');
  $('#pend-vazio').classList.toggle('hidden', arr.length>0);
  ligarCards('#lista-pendencias');
}

function renderCobrancas(){
  let arr=state.obras.filter(o=>{ const f=state.financeiro[o.id]; return f && f.status_cobranca && f.status_cobranca!=='nao_aplicavel'; });
  if(state.filtroCob==='pendentes') arr=arr.filter(o=>['a_cobrar','cobranca_enviada'].includes(state.financeiro[o.id].status_cobranca));
  else if(state.filtroCob!=='todas') arr=arr.filter(o=>state.financeiro[o.id].status_cobranca===state.filtroCob);
  arr.sort((a,b)=> new Date(b.concluida_em||0)-new Date(a.concluida_em||0));
  $('#lista-cobrancas').innerHTML = arr.map(o=>{
    const f=state.financeiro[o.id];
    return `<div class="card-obra" data-id="${o.id}">
      <div class="card-topo"><div><div class="card-cliente">${esc(o.cliente)}</div>
        ${o.orcamento_qs?`<div class="card-or">Orç. ${esc(o.orcamento_qs)}</div>`:''}
        <div class="card-end">Concluída ${dataBR(o.concluida_em)} ${o.concluida_por_nome?'por '+esc(o.concluida_por_nome):''}</div></div>
        <span class="cob-badge cob-${f.status_cobranca}">${COBRANCA[f.status_cobranca]}</span></div>
      <div class="card-prazo">${moeda(f.valor_cobrado??f.valor_total)}</div>
      <div class="card-rodape">
        ${f.status_cobranca==='a_cobrar'?`<button class="btn btn-aviso btn-sm js-cob-enviada" data-id="${o.id}">Marcar cobrança enviada</button>`:''}
        ${f.status_cobranca!=='pago'?`<button class="btn btn-ok btn-sm js-cob-pago" data-id="${o.id}">Marcar pago</button>`:''}
        ${o.telefone_cliente?`<button class="btn btn-sec btn-sm js-cob-wa" data-id="${o.id}">📲 WhatsApp cliente</button>`:''}
      </div></div>`;
  }).join('');
  $('#cob-vazio').classList.toggle('hidden', arr.length>0);
  $('#lista-cobrancas').querySelectorAll('.card-obra').forEach(c=>{
    c.querySelector('.js-cob-enviada')?.addEventListener('click', ev=>{ev.stopPropagation(); marcarCobranca(c.dataset.id,'cobranca_enviada');});
    c.querySelector('.js-cob-pago')?.addEventListener('click', ev=>{ev.stopPropagation(); marcarCobranca(c.dataset.id,'pago');});
    c.querySelector('.js-cob-wa')?.addEventListener('click', ev=>{ev.stopPropagation(); whatsappCobranca(c.dataset.id);});
    c.addEventListener('click', ()=>abrirObra(c.dataset.id));
  });
}

function ligarCards(sel){
  $(sel).querySelectorAll('.card-obra').forEach(c=>{
    c.querySelector('.js-materiais')?.addEventListener('click', ev=>{ ev.stopPropagation(); imprimirMateriais(c.dataset.id); });
    c.addEventListener('click', ()=> abrirObra(c.dataset.id));
  });
}

/* =====================================================================
   DETALHE DA OBRA
   ===================================================================== */
function abrirObra(id){
  const o=state.obras.find(x=>x.id===id); if(!o) return;
  const dias=diasRestantes(o), u=urg(dias,o.status_execucao);
  const fin=state.financeiro[o.id];
  const servs=(o.obra_servicos||[]);
  const itens=(o.obra_itens||[]).slice().sort((a,b)=>(a.ordem||0)-(b.ordem||0));
  const equipe=(o.equipe_confirmada?.length?o.equipe_confirmada:o.equipe_sugerida)||[];
  const sug = sugerirEquipe(servs.map(s=>s.servico), o.tem_skid);

  let html=`<h2>${esc(o.cliente)}</h2>
    <div class="det-sub"><span class="status-badge st-${o.status_execucao}">${STATUS[o.status_execucao].label}</span>
      <span class="dias urg-${u}" style="margin-left:6px">${textoDias(dias)}</span></div>`;

  // dados
  html+=`<div class="det-sec"><h3>Dados</h3>
    ${o.endereco?linha('Endereço',esc(o.endereco)):''}
    ${o.telefone_cliente?linha('Telefone',esc(o.telefone_cliente)):''}
    ${o.orcamento_qs?linha('Orçamento QS',esc(o.orcamento_qs)):''}
    ${o.data_inicio?linha('Início',dataBR(o.data_inicio)):''}
    ${o.data_prazo?linha('Prazo',dataBR(o.data_prazo)):''}
    ${state.isAdmin&&fin?.valor_total!=null?linha('Valor',moeda(fin.valor_total)):''}</div>`;

  // serviços
  if(servs.length){
    html+=`<div class="det-sec"><h3>Serviços (dias × pessoas)</h3><table class="tabela"><tr><th>Serviço</th><th>Dias</th><th>Pessoas</th></tr>
      ${servs.map(s=>`<tr><td>${esc(SERVICOS[s.servico]?.label||s.servico)}</td><td>${s.dias??'—'}</td><td>${s.pessoas??'—'}</td></tr>`).join('')}</table></div>`;
  }

  // equipe
  html+=`<div class="det-sec"><h3>Equipe</h3>
    <div class="det-linha"><span class="lbl">Definida</span><b>${equipe.length?esc(equipe.join(', ')):'—'}</b></div>
    <div class="det-linha"><span class="lbl">Sugerida</span><span>${sug.equipe.join(', ')||'—'}</span></div>
    ${sug.notas.map(n=>`<div class="nota ${n.tipo==='skid'?'skid':''}">${esc(n.texto)}</div>`).join('')}
    ${state.isAdmin?`<div class="acoes-status"><button class="btn btn-sec btn-sm" id="js-aplicar-sug">Usar sugestão</button>
      <button class="btn btn-sec btn-sm" id="js-editar-equipe">Editar equipe</button></div>`:''}</div>`;

  // materiais
  html+=`<div class="det-sec"><h3>Materiais (${itens.length})</h3>
    <button class="btn btn-sec btn-sm" id="js-print-mat">🖨 Imprimir folha de separação (Moritz)</button></div>`;

  // projeto
  html+=`<div class="det-sec"><h3>Projeto preventivo</h3>
    ${o.projeto_pdf_path?`<button class="btn btn-sec btn-sm" id="js-ver-pdf">📄 Ver projeto (PDF)</button>`:'<span class="card-end">Nenhum projeto anexado.</span>'}
    ${state.isAdmin?`<button class="btn btn-sec btn-sm" id="js-up-pdf">⬆ ${o.projeto_pdf_path?'Trocar':'Anexar'} PDF</button><input type="file" id="js-pdf-input" accept="application/pdf" class="hidden">`:''}</div>`;

  // observações
  html+=`<div class="det-sec"><h3>Observações</h3>
    <div class="obs-box">${o.observacoes?esc(o.observacoes):'<span class="card-end">Sem observações.</span>'}</div>
    ${state.isAdmin?`<button class="btn btn-sec btn-sm" id="js-edit-obs" style="margin-top:8px">✏️ Editar observações</button>`:''}</div>`;

  // anexos
  html+=`<div class="det-sec"><h3>Anexos</h3>
    <div id="js-anexos">carregando…</div>
    ${state.isAdmin?`<button class="btn btn-sec btn-sm" id="js-up-anexo" style="margin-top:8px">📎 Anexar arquivo</button><input type="file" id="js-anexo-input" class="hidden">`:''}</div>`;

  // status (admin)
  if(state.isAdmin){
    html+=`<div class="det-sec"><h3>Situação</h3><div class="acoes-status">
      <button class="btn btn-sec btn-sm js-status" data-s="em_andamento">Em andamento</button>
      <button class="btn btn-aviso btn-sm js-status" data-s="pendente_material">Pendente material</button>
      <button class="btn btn-sm js-status" data-s="pendente_execucao" style="background:#7a3bd0;color:#fff">Pendente execução</button>
      <button class="btn btn-ok btn-sm" id="js-concluir">✓ Confirmar 100% concluída</button>
    </div>${o.pendencia_obs?`<div class="nota">Pendência anotada: ${esc(o.pendencia_obs)}</div>`:''}</div>`;
    // cobrança
    if(fin && fin.status_cobranca!=='nao_aplicavel'){
      html+=`<div class="det-sec"><h3>Cobrança</h3>
        <div class="det-linha"><span class="lbl">Situação</span><b>${COBRANCA[fin.status_cobranca]}</b></div>
        ${fin.cobranca_enviada_em?linha('Enviada em',dataBR(fin.cobranca_enviada_em)):''}
        ${fin.pago_em?linha('Pago em',dataBR(fin.pago_em)):''}</div>`;
    }
  }

  // log
  html+=`<div class="det-sec"><h3>Histórico</h3><div id="js-log">carregando…</div></div>`;

  // ações admin
  if(state.isAdmin){
    html+=`<div class="form-acoes"><button class="btn btn-ghost" id="js-excluir">Excluir</button>
      <button class="btn btn-sec" id="js-editar">Editar obra</button></div>`;
  }

  abrirModal(html);

  // handlers
  $('#js-print-mat').onclick=()=>imprimirMateriais(o.id);
  $('#js-ver-pdf') && ($('#js-ver-pdf').onclick=()=>verPDF(o));
  $('#js-edit-obs') && ($('#js-edit-obs').onclick=()=>editarObs(o));
  $('#js-up-anexo') && ($('#js-up-anexo').onclick=()=>$('#js-anexo-input').click());
  $('#js-anexo-input') && ($('#js-anexo-input').onchange=e=>uploadAnexo(o, e.target.files[0]));
  carregarAnexos(o.id);
  if(state.isAdmin){
    $('#js-aplicar-sug').onclick=async()=>{ await salvarCampos(o.id,{equipe_confirmada:sug.equipe}); logar(o.id,'equipe','Aplicou equipe sugerida'); abrirObra(o.id); toast('Equipe aplicada.'); };
    $('#js-editar-equipe').onclick=()=>editarEquipeObra(o);
    $('#js-up-pdf').onclick=()=>$('#js-pdf-input').click();
    $('#js-pdf-input').onchange=e=>uploadPDF(o, e.target.files[0]);
    document.querySelectorAll('.js-status').forEach(b=>b.onclick=()=>mudarStatus(o.id,b.dataset.s));
    $('#js-concluir').onclick=()=>concluirObra(o);
    $('#js-editar').onclick=()=>formObra(o);
    $('#js-excluir').onclick=()=>excluirObra(o);
  }
  carregarLog(o.id);
}
function linha(lbl,val){ return `<div class="det-linha"><span class="lbl">${lbl}</span><span>${val}</span></div>`; }

async function carregarLog(id){
  const { data } = await sb.from('obra_log').select('*').eq('obra_id',id).order('criado_em',{ascending:false}).limit(12);
  const el=$('#js-log'); if(!el) return;
  el.innerHTML = (data&&data.length) ? data.map(l=>`<div class="log-item"><b>${esc(l.usuario_nome||'—')}</b> · ${esc(l.acao)}${l.detalhe?' — '+esc(l.detalhe):''} <small>(${new Date(l.criado_em).toLocaleString('pt-BR')})</small></div>`).join('') : '<span class="card-end">Sem registros.</span>';
}
async function logar(obra_id, acao, detalhe){
  await sb.from('obra_log').insert({ obra_id, usuario_id:state.user.id, usuario_nome:state.perfil?.nome||state.user.email, acao, detalhe });
}

/* ---------- ações de obra ---------- */
async function salvarCampos(id, campos){ const {error}=await sb.from('obras').update(campos).eq('id',id); if(error){toast(error.message,true);return false;} await carregarTudo(true); return true; }

async function mudarStatus(id, s){
  let obs=null;
  if(s==='pendente_material'){ obs=prompt('O que está faltando de material? (vai pra aba Pendências do Addson)'); if(obs===null) return; }
  else if(s==='pendente_execucao'){ obs=prompt('O que falta executar?')||null; }
  const campos={status_execucao:s, pendencia_obs:(s.startsWith('pendente')?obs:null)};
  if(await salvarCampos(id,campos)){ await logar(id,'status',STATUS[s].label+(obs?': '+obs:'')); toast('Situação atualizada.'); abrirObra(id); }
}

async function concluirObra(o){
  if(!confirm(`Confirmar que a obra "${o.cliente}" está 100% concluída?\nVai para a aba Cobranças do financeiro.`)) return;
  const ok=await salvarCampos(o.id,{ status_execucao:'concluida', pendencia_obs:null,
    concluida_por:state.user.id, concluida_por_nome:state.perfil?.nome||state.user.email, concluida_em:new Date().toISOString() });
  if(!ok) return;
  // joga para cobrança (a_cobrar), preservando valor_total
  const fin=state.financeiro[o.id]||{};
  await sb.from('obra_financeiro').upsert({ obra_id:o.id, valor_total:fin.valor_total??null, status_cobranca:'a_cobrar' });
  await logar(o.id,'conclusão','Confirmada 100% concluída → enviada para cobrança');
  await carregarTudo(true); toast('✓ Concluída e enviada para Cobranças.'); abrirObra(o.id);
}

async function marcarCobranca(id, status){
  const campos={ status_cobranca:status };
  if(status==='cobranca_enviada') campos.cobranca_enviada_em=new Date().toISOString();
  if(status==='pago') campos.pago_em=new Date().toISOString();
  const {error}=await sb.from('obra_financeiro').update(campos).eq('obra_id',id);
  if(error){toast(error.message,true);return;}
  await logar(id,'cobrança',COBRANCA[status]);
  await carregarTudo(true); toast('Cobrança: '+COBRANCA[status]);
}
function whatsappCobranca(id){
  const o=state.obras.find(x=>x.id===id); const fin=state.financeiro[id];
  const txt=`Olá! Aqui é da Rodrigues Preventivos. Referente ao serviço${o.orcamento_qs?' (orç. '+o.orcamento_qs+')':''} na obra ${o.cliente}, segue a cobrança no valor de ${moeda(fin.valor_cobrado??fin.valor_total)}. Qualquer dúvida estamos à disposição!`;
  const l=waLink(o.telefone_cliente,txt); if(l) window.open(l,'_blank'); else toast('Sem telefone do cliente.',true);
}

async function excluirObra(o){
  if(!confirm(`Excluir a obra "${o.cliente}"? Esta ação não pode ser desfeita.`)) return;
  const {error}=await sb.from('obras').delete().eq('id',o.id);
  if(error){toast(error.message,true);return;}
  fecharModal(); await carregarTudo(true); toast('Obra excluída.');
}

/* ---------- editar equipe inline ---------- */
function editarEquipeObra(o){
  const atual=new Set((o.equipe_confirmada?.length?o.equipe_confirmada:o.equipe_sugerida)||[]);
  const chips=state.equipe.filter(e=>e.ativo).map(e=>`<button type="button" class="pessoa-chip ${atual.has(e.nome)?'sel':''} ${e.coringa?'coringa':''}" data-n="${esc(e.nome)}">${esc(e.nome)}${e.parceiro?' ⚙':''}${e.coringa?' ★':''}</button>`).join('');
  abrirModal(`<h2>Equipe — ${esc(o.cliente)}</h2><p class="det-sub">Clique para incluir/remover. ★ coringa · ⚙ parceiro.</p>
    <div class="equipe-pick" id="pick">${chips}</div>
    <div class="form-acoes"><button class="btn btn-ghost" id="volta">Voltar</button><button class="btn btn-primary" id="salva-eq">Salvar equipe</button></div>`);
  $('#pick').querySelectorAll('.pessoa-chip').forEach(c=>c.onclick=()=>c.classList.toggle('sel'));
  $('#volta').onclick=()=>abrirObra(o.id);
  $('#salva-eq').onclick=async()=>{ const sel=[...$('#pick').querySelectorAll('.sel')].map(c=>c.dataset.n);
    if(await salvarCampos(o.id,{equipe_confirmada:sel})){ await logar(o.id,'equipe','Definiu: '+(sel.join(', ')||'(vazio)')); abrirObra(o.id); toast('Equipe salva.'); } };
}

/* =====================================================================
   PROJETO PDF
   ===================================================================== */
async function uploadPDF(o, file){
  if(!file) return; if(file.type!=='application/pdf'){ toast('Selecione um PDF.',true); return; }
  toast('Enviando projeto…');
  const path=`${o.id}/${Date.now()}_${file.name.replace(/[^\w.\-]/g,'_')}`;
  const { error }=await sb.storage.from('projetos').upload(path, file, { upsert:true });
  if(error){ toast('Erro no upload: '+error.message, true); return; }
  if(o.projeto_pdf_path) await sb.storage.from('projetos').remove([o.projeto_pdf_path]);
  await salvarCampos(o.id,{ projeto_pdf_path:path }); await logar(o.id,'projeto','Anexou projeto PDF');
  toast('Projeto anexado.'); abrirObra(o.id);
}
async function verPDF(o){
  const { data, error }=await sb.storage.from('projetos').createSignedUrl(o.projeto_pdf_path, 3600);
  if(error){ toast(error.message,true); return; } window.open(data.signedUrl,'_blank');
}

/* ---------- observações ---------- */
function editarObs(o){
  abrirModal(`<h2>Observações — ${esc(o.cliente)}</h2>
    <textarea id="obs-area" class="campo" style="width:100%;min-height:150px;font-family:inherit" placeholder="Ex.: precisa de empilhadeira; cliente pediu pra avisar antes; etc.">${esc(o.observacoes||'')}</textarea>
    <div class="form-acoes"><button class="btn btn-ghost" id="obs-volta">Voltar</button><button class="btn btn-primary" id="obs-salva">Salvar</button></div>`);
  $('#obs-volta').onclick=()=>abrirObra(o.id);
  $('#obs-salva').onclick=async()=>{ if(await salvarCampos(o.id,{observacoes:$('#obs-area').value.trim()||null})){ await logar(o.id,'observações','Editou observações'); abrirObra(o.id); toast('Observações salvas.'); } };
}

/* ---------- anexos (qualquer arquivo, vários por obra) ---------- */
async function carregarAnexos(id){
  const el=$('#js-anexos'); if(!el) return;
  const { data, error }=await sb.from('obra_anexos').select('*').eq('obra_id',id).order('criado_em');
  if(error){ el.innerHTML='<span class="card-end">Anexos indisponíveis — rode a migração SQL (migracao_anexos_obs.sql).</span>'; return; }
  if(!data||!data.length){ el.innerHTML='<span class="card-end">Nenhum anexo.</span>'; return; }
  el.innerHTML=data.map(a=>`<div class="anexo-item"><a href="#" class="js-ver-anexo" data-p="${esc(a.path)}">📄 ${esc(a.nome)}</a>
    <small>${a.criado_por_nome?esc(a.criado_por_nome):''}</small>
    ${state.isAdmin?`<button class="x-row js-del-anexo" data-id="${a.id}" data-p="${esc(a.path)}" title="Excluir">×</button>`:''}</div>`).join('');
  el.querySelectorAll('.js-ver-anexo').forEach(x=>x.onclick=ev=>{ev.preventDefault(); verAnexo(x.dataset.p);});
  el.querySelectorAll('.js-del-anexo').forEach(x=>x.onclick=()=>excluirAnexo(id, x.dataset.id, x.dataset.p));
}
async function uploadAnexo(o, file){
  if(!file) return; toast('Enviando anexo…');
  const path=`${o.id}/anexos/${Date.now()}_${file.name.replace(/[^\w.\-]/g,'_')}`;
  const { error }=await sb.storage.from('projetos').upload(path, file);
  if(error){ toast('Erro no upload: '+error.message, true); return; }
  const { error:e2 }=await sb.from('obra_anexos').insert({ obra_id:o.id, nome:file.name, path,
    mime:file.type||null, tamanho:file.size||null, criado_por_nome:state.perfil?.nome||state.user.email });
  if(e2){ toast('Erro: '+e2.message, true); return; }
  await logar(o.id,'anexo','Anexou '+file.name); toast('Anexo enviado.'); carregarAnexos(o.id);
}
async function verAnexo(path){
  const { data, error }=await sb.storage.from('projetos').createSignedUrl(path, 3600);
  if(error){ toast(error.message,true); return; } window.open(data.signedUrl,'_blank');
}
async function excluirAnexo(obraId, id, path){
  if(!confirm('Excluir este anexo?')) return;
  await sb.storage.from('projetos').remove([path]);
  await sb.from('obra_anexos').delete().eq('id',id);
  await logar(obraId,'anexo','Removeu anexo'); carregarAnexos(obraId); toast('Anexo removido.');
}

/* =====================================================================
   FOLHA DE MATERIAIS (impressão — só quantidades, SEM valores)
   ===================================================================== */
function imprimirMateriais(id){
  const o=state.obras.find(x=>x.id===id); if(!o) return;
  const itens=(o.obra_itens||[]).slice().sort((a,b)=>(a.ordem||0)-(b.ordem||0));
  const logo=new URL('assets/logo.png', location.href).href;
  const linhas = itens.length ? itens.map((it,i)=>`<tr><td class="c">${i+1}</td><td>${esc(it.produto)}</td>
      <td class="c"><b>${Number(it.quantidade).toLocaleString('pt-BR')}</b></td><td class="c">${esc(it.unidade||'')}</td><td class="chk"></td></tr>`).join('')
    : `<tr><td colspan="5" style="text-align:center;color:#888">Nenhum material cadastrado nesta obra.</td></tr>`;
  const w=window.open('','_blank','width=820,height=900'); if(!w){ toast('Permita pop-ups para imprimir.',true); return; }
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Separação — ${esc(o.cliente)}</title>
  <style>
    *{font-family:Arial,Helvetica,sans-serif} body{margin:26px;color:#1f2430}
    .top{display:flex;align-items:center;gap:14px;border-bottom:3px solid #E84A56;padding-bottom:10px}
    .top img{height:46px} h1{font-size:18px;margin:0} .sub{color:#666;font-size:13px;margin-top:2px}
    .info{margin:14px 0;font-size:14px;line-height:1.7} .info b{display:inline-block;min-width:90px;color:#555}
    table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}
    th,td{border:1px solid #ccc;padding:7px 8px;text-align:left} th{background:#f3f3f3}
    td.c,th.c{text-align:center} .chk{width:42px} td.chk{height:26px}
    .rod{margin-top:30px;font-size:12px;color:#666;display:flex;justify-content:space-between}
    @media print{ .noprint{display:none} body{margin:10px} }
  </style></head><body>
    <div class="top"><img src="${logo}"><div><h1>Folha de Separação de Materiais</h1>
      <div class="sub">Rodrigues Preventivos · uso interno — estoque</div></div></div>
    <div class="info">
      <div><b>Cliente:</b> ${esc(o.cliente)}</div>
      ${o.endereco?`<div><b>Endereço:</b> ${esc(o.endereco)}</div>`:''}
      ${o.orcamento_qs?`<div><b>Orçamento:</b> ${esc(o.orcamento_qs)}</div>`:''}
      <div><b>Serviços:</b> ${(o.obra_servicos||[]).map(s=>esc(SERVICOS[s.servico]?.label||s.servico)).join(', ')||'—'}</div>
      <div><b>Data:</b> ${new Date().toLocaleDateString('pt-BR')}${o.data_prazo?`  ·  <b>Prazo:</b> ${dataBR(o.data_prazo)}`:''}</div>
    </div>
    <table><tr><th class="c">#</th><th>Material</th><th class="c">Qtd</th><th class="c">Un.</th><th class="c">Separado</th></tr>${linhas}</table>
    <div class="rod"><span>Separado por: ____________________</span><span>Conferido: ____________________</span></div>
    <button class="noprint" onclick="window.print()" style="margin-top:20px;padding:10px 18px;background:#E84A56;color:#fff;border:0;border-radius:8px;font-size:14px;cursor:pointer">Imprimir</button>
  </body></html>`);
  w.document.close();
}

/* =====================================================================
   FORMULÁRIO NOVA / EDITAR OBRA
   ===================================================================== */
$('#btn-nova-obra').addEventListener('click', ()=>formObra(null));

function formObra(o){
  const ed=!!o; const fin = o?state.financeiro[o.id]:null;
  const servOpts=Object.entries(SERVICOS).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('');
  const servRows=(o?.obra_servicos||[]).map(s=>servRow(s,servOpts)).join('') || servRow(null,servOpts);
  const itemRows=(o?.obra_itens||[]).sort((a,b)=>(a.ordem||0)-(b.ordem||0)).map(itemRow).join('') || itemRow(null);
  const eqAtual=new Set((o?.equipe_confirmada)||[]);
  const eqChips=state.equipe.filter(e=>e.ativo).map(e=>`<button type="button" class="pessoa-chip ${eqAtual.has(e.nome)?'sel':''} ${e.coringa?'coringa':''}" data-n="${esc(e.nome)}">${esc(e.nome)}${e.parceiro?' ⚙':''}${e.coringa?' ★':''}</button>`).join('');

  abrirModal(`<h2>${ed?'Editar obra':'Nova obra'}</h2>
    <form id="form-obra"><div class="form-grid">
      <label class="campo full">Cliente *<input name="cliente" required value="${esc(o?.cliente||'')}"></label>
      <label class="campo full">Endereço<input name="endereco" value="${esc(o?.endereco||'')}"></label>
      <label class="campo">Telefone do cliente<input name="telefone_cliente" value="${esc(o?.telefone_cliente||'')}"></label>
      <label class="campo">Orçamento QS<input name="orcamento_qs" placeholder="OR901" value="${esc(o?.orcamento_qs||'')}"></label>
      <label class="campo">Data de início<input type="date" name="data_inicio" value="${o?.data_inicio||''}"></label>
      <label class="campo">Prazo (entrega)<input type="date" name="data_prazo" value="${o?.data_prazo||''}"></label>
      <label class="campo">Valor total (R$)<input type="number" step="0.01" name="valor_total" value="${fin?.valor_total??''}"></label>
      <label class="campo" style="flex-direction:row;align-items:center;gap:8px;font-weight:600"><input type="checkbox" name="tem_skid" ${o?.tem_skid?'checked':''} style="width:auto"> Tem SKID de bombas</label>
      <label class="campo full">Observações<textarea name="observacoes" rows="2">${esc(o?.observacoes||'')}</textarea></label>
    </div>

    <div class="det-sec"><h3>Serviços (dias × pessoas)</h3><div id="serv-list">${servRows}</div>
      <button type="button" class="mini-add" id="add-serv">+ adicionar serviço</button></div>

    <div class="det-sec"><h3>Materiais (produto + quantidade — vira a folha do Moritz)</h3><div id="item-list">${itemRows}</div>
      <button type="button" class="mini-add" id="add-item">+ adicionar material</button></div>

    <div class="det-sec"><h3>Equipe <small>— a sugestão preenche ao salvar; ajuste se quiser</small></h3>
      <div class="acoes-status" style="margin-bottom:8px"><button type="button" class="btn btn-sec btn-sm" id="btn-sugerir">✨ Sugerir agora</button></div>
      <div class="equipe-pick" id="eq-pick">${eqChips}</div></div>

    <div class="form-acoes"><button type="button" class="btn btn-ghost" id="cancela">Cancelar</button>
      <button type="submit" class="btn btn-primary">${ed?'Salvar alterações':'Criar obra'}</button></div>
    </form>`);

  $('#add-serv').onclick=()=>{ const d=document.createElement('div'); d.innerHTML=servRow(null,servOpts); $('#serv-list').appendChild(d.firstElementChild); ligarRemover(); };
  $('#add-item').onclick=()=>{ const d=document.createElement('div'); d.innerHTML=itemRow(null); $('#item-list').appendChild(d.firstElementChild); ligarRemover(); };
  ligarRemover();
  $('#eq-pick').querySelectorAll('.pessoa-chip').forEach(c=>c.onclick=()=>c.classList.toggle('sel'));
  $('#btn-sugerir').onclick=()=>{ const {servicos,temSkid}=lerServicos(); const sug=sugerirEquipe(servicos,temSkid);
    const set=new Set(sug.equipe); $('#eq-pick').querySelectorAll('.pessoa-chip').forEach(c=>c.classList.toggle('sel',set.has(c.dataset.n)));
    toast(sug.equipe.length?('Sugerido: '+sug.equipe.join(', ')):'Selecione ao menos um serviço.'); };
  $('#cancela').onclick=()=> o?abrirObra(o.id):fecharModal();
  $('#form-obra').onsubmit=e=>{ e.preventDefault(); salvarObra(o); };
}
function servRow(s,opts){ return `<div class="serv-row"><select class="f-serv">${opts.replace(`value="${s?.servico}"`,`value="${s?.servico}" selected`)}</select>
  <input class="f-dias" type="number" min="0" placeholder="dias" value="${s?.dias??''}">
  <input class="f-pess" type="number" min="0" placeholder="pessoas" value="${s?.pessoas??''}">
  <button type="button" class="x-row js-rm">×</button></div>`; }
function itemRow(it){ return `<div class="item-row"><input class="prod" placeholder="Material / produto" value="${esc(it?.produto||'')}">
  <input class="qtd" type="number" step="0.001" placeholder="qtd" value="${it?.quantidade??''}">
  <input class="uni" placeholder="un." value="${esc(it?.unidade||'')}">
  <button type="button" class="x-row js-rm">×</button></div>`; }
function ligarRemover(){ document.querySelectorAll('#form-obra .js-rm').forEach(b=>b.onclick=()=>b.parentElement.remove()); }
function lerServicos(){ const servicos=[]; let temSkid=$('#form-obra [name=tem_skid]').checked;
  document.querySelectorAll('#serv-list .serv-row').forEach(r=>{ const s=r.querySelector('.f-serv').value; if(s) servicos.push(s); });
  return {servicos,temSkid}; }

async function salvarObra(o){
  const f=$('#form-obra');
  const cliente=f.cliente.value.trim(); if(!cliente){ toast('Informe o cliente.',true); return; }
  const servicos=[...document.querySelectorAll('#serv-list .serv-row')].map(r=>({servico:r.querySelector('.f-serv').value,
    dias:r.querySelector('.f-dias').value?+r.querySelector('.f-dias').value:null, pessoas:r.querySelector('.f-pess').value?+r.querySelector('.f-pess').value:null})).filter(s=>s.servico);
  const itens=[...document.querySelectorAll('#item-list .item-row')].map((r,i)=>({produto:r.querySelector('.prod').value.trim(),
    quantidade:+r.querySelector('.qtd').value||0, unidade:r.querySelector('.uni').value.trim()||null, ordem:i})).filter(i=>i.produto);
  let equipe=[...$('#eq-pick').querySelectorAll('.sel')].map(c=>c.dataset.n);
  const temSkid=f.tem_skid.checked;
  const sug=sugerirEquipe(servicos.map(s=>s.servico),temSkid);
  if(!equipe.length) equipe=sug.equipe; // se admin não escolheu, usa sugestão
  const valor=f.valor_total.value!==''?+f.valor_total.value:null;

  const dados={ cliente, endereco:f.endereco.value.trim()||null, telefone_cliente:f.telefone_cliente.value.trim()||null,
    orcamento_qs:f.orcamento_qs.value.trim()||null, data_inicio:f.data_inicio.value||null, data_prazo:f.data_prazo.value||null,
    tem_skid:temSkid, observacoes:f.observacoes.value.trim()||null, equipe_sugerida:sug.equipe, equipe_confirmada:equipe };

  let obraId=o?.id;
  if(o){ const {error}=await sb.from('obras').update(dados).eq('id',o.id); if(error){toast(error.message,true);return;} }
  else { const {data,error}=await sb.from('obras').insert(dados).select('id').single(); if(error){toast(error.message,true);return;} obraId=data.id; }

  // filhos: substitui tudo
  await sb.from('obra_servicos').delete().eq('obra_id',obraId);
  if(servicos.length) await sb.from('obra_servicos').insert(servicos.map(s=>({...s,obra_id:obraId})));
  await sb.from('obra_itens').delete().eq('obra_id',obraId);
  if(itens.length) await sb.from('obra_itens').insert(itens.map(i=>({...i,obra_id:obraId})));

  // financeiro (valor) — preserva status de cobrança existente
  const finAtual=state.financeiro[obraId];
  await sb.from('obra_financeiro').upsert({ obra_id:obraId, valor_total:valor, status_cobranca:finAtual?.status_cobranca||'nao_aplicavel' });

  await logar(obraId, o?'edição':'criação', o?'Editou a obra':'Cadastrou a obra');
  await carregarTudo(true); toast(o?'Obra atualizada.':'Obra criada.'); abrirObra(obraId);
}

/* =====================================================================
   EQUIPE (admin) — adicionar/editar membros
   ===================================================================== */
const SKILLS=['SHP','SPDA','SDAI','VITAIS','GAS','SKID','AJUDANTE','PAINEL_ELETRICO','STARTUP_BOMBA'];
function renderEquipe(){
  $('#lista-equipe').innerHTML=state.equipe.map(e=>`<div class="card-membro ${e.ativo?'':'inativo'}" data-id="${e.id}">
    <div class="nome">${esc(e.nome)} ${e.parceiro?'<span class="tag parc">parceiro</span>':''} ${e.coringa?'<span class="tag cor">coringa</span>':''}</div>
    <div class="funcao">${esc(e.funcao||'')}</div>
    <div>${(e.principais||[]).map(s=>`<span class="tag">${s}</span>`).join('')}</div>
    ${(e.habilidades||[]).length?`<div style="margin-top:4px"><small>ajuda: ${e.habilidades.filter(h=>!e.principais.includes(h)).join(', ')||'—'}</small></div>`:''}
  </div>`).join('');
  $('#lista-equipe').querySelectorAll('.card-membro').forEach(c=>c.onclick=()=>formMembro(state.equipe.find(e=>e.id===c.dataset.id)));
}
$('#btn-novo-membro').addEventListener('click',()=>formMembro(null));
function formMembro(m){
  const chk=(arr,sk)=>arr&&arr.includes(sk)?'checked':'';
  abrirModal(`<h2>${m?'Editar':'Adicionar'} membro</h2><form id="form-membro">
    <label class="campo full">Nome *<input name="nome" required value="${esc(m?.nome||'')}"></label>
    <label class="campo full">Função<input name="funcao" value="${esc(m?.funcao||'')}"></label>
    <div class="det-sec"><h3>Especialidades (principais)</h3><div class="equipe-pick">
      ${SKILLS.map(s=>`<label class="pessoa-chip"><input type="checkbox" class="pri" value="${s}" ${chk(m?.principais,s)} style="margin-right:5px">${s}</label>`).join('')}</div></div>
    <div class="det-sec"><h3>Também ajuda em</h3><div class="equipe-pick">
      ${SKILLS.map(s=>`<label class="pessoa-chip"><input type="checkbox" class="hab" value="${s}" ${chk(m?.habilidades,s)} style="margin-right:5px">${s}</label>`).join('')}</div></div>
    <div class="acoes-status">
      <label class="pessoa-chip"><input type="checkbox" name="coringa" ${m?.coringa?'checked':''} style="margin-right:5px">Coringa (por fora)</label>
      <label class="pessoa-chip"><input type="checkbox" name="parceiro" ${m?.parceiro?'checked':''} style="margin-right:5px">Parceiro</label>
      <label class="pessoa-chip"><input type="checkbox" name="ativo" ${(!m||m.ativo)?'checked':''} style="margin-right:5px">Ativo</label>
    </div>
    <div class="form-acoes">${m?'<button type="button" class="btn btn-ghost" id="rm-membro">Remover</button>':''}
      <button type="button" class="btn btn-ghost" id="cancela-m">Cancelar</button>
      <button type="submit" class="btn btn-primary">Salvar</button></div></form>`);
  $('#cancela-m').onclick=fecharModal;
  $('#rm-membro')&&($('#rm-membro').onclick=async()=>{ if(!confirm('Remover '+m.nome+'?'))return; await sb.from('equipe').delete().eq('id',m.id); await carregarTudo(true); fecharModal(); toast('Removido.'); });
  $('#form-membro').onsubmit=async e=>{ e.preventDefault(); const f=e.target;
    const principais=[...f.querySelectorAll('.pri:checked')].map(c=>c.value);
    let habilidades=[...f.querySelectorAll('.hab:checked')].map(c=>c.value);
    habilidades=[...new Set([...principais,...habilidades])]; // principais sempre contam como habilidade
    const dados={ nome:f.nome.value.trim(), funcao:f.funcao.value.trim()||null, principais, habilidades,
      coringa:f.coringa.checked, parceiro:f.parceiro.checked, ativo:f.ativo.checked };
    if(m){ await sb.from('equipe').update(dados).eq('id',m.id); } else { await sb.from('equipe').insert(dados); }
    await carregarTudo(true); fecharModal(); toast('Equipe salva.'); };
}

/* =====================================================================
   MÓDULO MONITORAMENTO (edificações de clientes no e-SCI / Bombeiros)
   ===================================================================== */
$('#btn-novo-cliente-mon') && $('#btn-novo-cliente-mon').addEventListener('click', ()=>formClienteMon(null));

async function carregarMonitor(){
  const el=$('#lista-monitor'); if(!el.innerHTML) el.innerHTML='<div class="vazio">Carregando…</div>';
  const { data, error }=await sb.from('monitor_clientes').select('*, monitor_res(*, monitor_autos(*))').order('nome');
  if(error){ el.innerHTML=`<div class="vazio">Indisponível — rode a migração <code>migracao_monitoramento.sql</code> no Supabase.<br><small>${esc(error.message)}</small></div>`; $('#monitor-vazio').classList.add('hidden'); return; }
  state.monitor=data||[]; renderMonitor();
}
function _addMeses(s,n){ const d=new Date(s+'T00:00:00'); d.setMonth(d.getMonth()+n); return d; }
function _addAnos(s,n){ const d=new Date(s+'T00:00:00'); d.setFullYear(d.getFullYear()+n); return d; }
function _diasDe(d){ const h=new Date(); h.setHours(0,0,0,0); return Math.round((d-h)/86400000); }
function _iso(d){ return d.toISOString().slice(0,10); }
function funcStatus(re){
  let v=null;
  if(re.funcionamento_validade) v=new Date(re.funcionamento_validade+'T00:00:00');
  else if(re.funcionamento_data) v=_addAnos(re.funcionamento_data,1);
  if(!v) return {txt:'Funcionamento: não informado', cls:'cinza'};
  const dias=_diasDe(v);
  if(dias<0) return {txt:`⚠ Funcionamento VENCIDO há ${-dias} dias`, cls:'vermelho'};
  return {txt:`Funcionamento vence em ${dias} dias (${dataBR(_iso(v))})`, cls: dias<=30?'vermelho':dias<=90?'ambar':'verde'};
}
function manutStatus(re){
  if(!re.ultima_manutencao) return {txt:'Manutenção: a agendar', cls:'cinza'};
  const p=_addMeses(re.ultima_manutencao,5), dias=_diasDe(p);
  if(dias<0) return {txt:`🔧 Manutenção vencida há ${-dias} dias`, cls:'vermelho'};
  return {txt:`Próx. manutenção em ${dias} dias (${dataBR(_iso(p))})`, cls: dias<=15?'vermelho':dias<=45?'ambar':'verde'};
}
function renderMonitor(){
  const el=$('#lista-monitor');
  $('#monitor-vazio').classList.toggle('hidden', state.monitor.length>0);
  el.innerHTML=state.monitor.map(c=>{
    const res=(c.monitor_res||[]).slice().sort((a,b)=>(a.cidade||'').localeCompare(b.cidade||''));
    const linhas=res.map(re=>{
      const autos=(re.monitor_autos||[]).filter(a=>!a.resolvido);
      const novos=autos.filter(a=>a.novo).length;
      const f=funcStatus(re), m=manutStatus(re);
      const alerta=autos.length?`<span class="status-badge st-pendente_material">🔴 ${autos.length} auto(s)${novos?' • '+novos+' novo(s)':''}</span>`:'';
      const autosTxt=autos.length?`<div class="re-autos">${autos.map(a=>`<div class="re-auto-li">
        <span class="chip-serv ${a.tipo==='MUL'?'SDAI':'MANUT_SHP'}">${esc(a.tipo)}</span> <b>${esc(a.codigo)}</b>${a.valor!=null?' · '+moeda(a.valor):''}
        ${a.exigencia?'— '+esc(a.exigencia.length>90?a.exigencia.slice(0,90)+'…':a.exigencia):''}${a.prazo?' · <small>prazo '+esc(a.prazo)+'</small>':''}</div>`).join('')}</div>`:'';
      return `<div class="re-row" data-id="${re.id}">
        <div class="re-top"><b>${esc(re.re_codigo)}</b> <span class="re-nome">${esc(re.nome_edificacao||'(sem nome)')}</span> <small>${esc(re.cidade||'')}</small></div>
        <div class="re-badges"><span class="dias urg-${f.cls}">${f.txt}</span><span class="dias urg-${m.cls}">${m.txt}</span>${alerta}</div>
        ${autosTxt}
      </div>`;
    }).join('') || '<div class="card-end" style="padding:6px 2px">Nenhuma RE cadastrada.</div>';
    return `<div class="cliente-mon">
      <div class="cliente-mon-top">
        <div><div class="cliente-nome">${esc(c.nome)}</div>
          <small>${c.telefone?'📞 '+esc(c.telefone)+'  ':''}${c.contabilidade_nome?'· Contab.: '+esc(c.contabilidade_nome)+(c.contabilidade_telefone?' ('+esc(c.contabilidade_telefone)+')':''):''}</small></div>
        ${state.isAdmin?`<div class="cli-acoes"><button class="btn btn-sec btn-sm js-add-re" data-c="${c.id}">+ RE</button><button class="btn btn-ghost btn-sm js-edit-cli" data-c="${c.id}">✏️</button></div>`:''}
      </div>
      <div class="re-list">${linhas}</div></div>`;
  }).join('');
  el.querySelectorAll('.re-row').forEach(r=>r.onclick=()=>abrirRE(r.dataset.id));
  el.querySelectorAll('.js-add-re').forEach(b=>b.onclick=ev=>{ev.stopPropagation(); formRE(b.dataset.c,null);});
  el.querySelectorAll('.js-edit-cli').forEach(b=>b.onclick=ev=>{ev.stopPropagation(); formClienteMon(state.monitor.find(c=>c.id===b.dataset.c));});
}
function formClienteMon(c){
  abrirModal(`<h2>${c?'Editar cliente':'Novo cliente'}</h2><form id="form-cli-mon">
    <label class="campo full">Nome *<input name="nome" required value="${esc(c?.nome||'')}"></label>
    <label class="campo full">Telefone do cliente<input name="telefone" value="${esc(c?.telefone||'')}"></label>
    <label class="campo full">Contabilidade — nome<input name="contabilidade_nome" value="${esc(c?.contabilidade_nome||'')}"></label>
    <label class="campo full">Contabilidade — telefone<input name="contabilidade_telefone" value="${esc(c?.contabilidade_telefone||'')}"></label>
    <div class="form-acoes">${c?'<button type="button" class="btn btn-ghost" id="cli-del">Excluir</button>':''}<button type="button" class="btn btn-ghost" id="cli-cancel">Cancelar</button><button type="submit" class="btn btn-primary">Salvar</button></div></form>`);
  $('#cli-cancel').onclick=fecharModal;
  $('#cli-del') && ($('#cli-del').onclick=async()=>{ if(!confirm('Excluir o cliente e todas as RE/autos dele?'))return; await sb.from('monitor_clientes').delete().eq('id',c.id); await carregarMonitor(); fecharModal(); toast('Cliente excluído.'); });
  $('#form-cli-mon').onsubmit=async e=>{ e.preventDefault(); const f=e.target;
    const d={nome:f.nome.value.trim(), telefone:f.telefone.value.trim()||null, contabilidade_nome:f.contabilidade_nome.value.trim()||null, contabilidade_telefone:f.contabilidade_telefone.value.trim()||null};
    if(!d.nome){toast('Informe o nome.',true);return;}
    const {error}= c ? await sb.from('monitor_clientes').update(d).eq('id',c.id) : await sb.from('monitor_clientes').insert(d);
    if(error){toast(error.message,true);return;}
    await carregarMonitor(); fecharModal(); toast('Cliente salvo.'); };
}
function formRE(clienteId, re){
  abrirModal(`<h2>${re?'Editar RE':'Nova RE'}</h2><form id="form-re">
    <label class="campo full">Código RE *<input name="re_codigo" required placeholder="RE8055001147A" value="${esc(re?.re_codigo||'')}"></label>
    <label class="campo full">Nome da edificação<input name="nome_edificacao" value="${esc(re?.nome_edificacao||'')}"></label>
    <label class="campo">Cidade<input name="cidade" value="${esc(re?.cidade||'')}"></label>
    <label class="campo">Endereço<input name="endereco" value="${esc(re?.endereco||'')}"></label>
    <p class="det-sub">Nome/cidade/endereço o coletor preenche sozinho — pode deixar em branco.</p>
    <div class="form-acoes"><button type="button" class="btn btn-ghost" id="re-cancel">Cancelar</button><button type="submit" class="btn btn-primary">Salvar</button></div></form>`);
  $('#re-cancel').onclick=fecharModal;
  $('#form-re').onsubmit=async e=>{ e.preventDefault(); const f=e.target;
    const d={cliente_id:clienteId, re_codigo:f.re_codigo.value.trim().toUpperCase(), nome_edificacao:f.nome_edificacao.value.trim()||null, cidade:f.cidade.value.trim()||null, endereco:f.endereco.value.trim()||null};
    if(!d.re_codigo){toast('Informe o código RE.',true);return;}
    const {error}= re ? await sb.from('monitor_res').update(d).eq('id',re.id) : await sb.from('monitor_res').insert(d);
    if(error){toast(error.message,true);return;}
    await carregarMonitor(); fecharModal(); toast('RE salva.'); };
}
function abrirRE(id){
  let re,cli; for(const c of state.monitor){ const r=(c.monitor_res||[]).find(x=>x.id===id); if(r){re=r;cli=c;break;} }
  if(!re) return;
  const f=funcStatus(re), m=manutStatus(re);
  const autos=(re.monitor_autos||[]).slice().sort((a,b)=>(b.novo?1:0)-(a.novo?1:0));
  const bg=k=>k==='vermelho'?'#fde7e7':k==='ambar'?'#fef3da':k==='verde'?'#e7f7ee':'#eef1f6';
  let html=`<h2>${esc(re.re_codigo)}</h2><div class="det-sub">${esc(re.nome_edificacao||'(sem nome)')} · ${esc(re.cidade||'')} · cliente <b>${esc(cli.nome)}</b></div>`;
  html+=`<div class="det-sec"><h3>Funcionamento (validade = emissão + 1 ano)</h3>
    <div class="det-linha"><span class="lbl">Última emissão</span><span>${re.funcionamento_data?dataBR(re.funcionamento_data):'—'}</span></div>
    <div class="nota" style="background:${bg(f.cls)};color:#333">${f.txt}</div>
    ${cli.contabilidade_nome?`<div class="det-linha"><span class="lbl">Avisar</span><span>Contab.: ${esc(cli.contabilidade_nome)} ${cli.contabilidade_telefone?esc(cli.contabilidade_telefone):''}</span></div>`:''}
    ${state.isAdmin?`<div class="acoes-status"><button class="btn btn-sec btn-sm" id="re-func">Definir data de emissão</button></div>`:''}</div>`;
  html+=`<div class="det-sec"><h3>Manutenção (a cada 5 meses)</h3>
    <div class="det-linha"><span class="lbl">Última</span><span>${re.ultima_manutencao?dataBR(re.ultima_manutencao):'—'}</span></div>
    <div class="nota" style="background:${bg(m.cls)};color:#333">${m.txt}</div>
    ${state.isAdmin?`<div class="acoes-status"><button class="btn btn-ok btn-sm" id="re-manut">✓ Fiz manutenção hoje</button><button class="btn btn-sec btn-sm" id="re-manut-data">Outra data…</button></div>`:''}</div>`;
  html+=`<div class="det-sec"><h3>Autos (AF / Multas)</h3>`;
  html+= autos.length ? autos.map(a=>`<div class="auto-row${a.resolvido?' resolvido':''}">
      <span class="chip-serv ${a.tipo==='MUL'?'SDAI':'MANUT_SHP'}">${esc(a.tipo)}</span> <b>${esc(a.codigo)}</b> ${a.data?'· '+esc(a.data):''}
      ${a.novo&&!a.resolvido?'<span class="status-badge st-pendente_material">NOVO</span>':''} ${a.situacao?'· '+esc(a.situacao):''}
      ${a.valor!=null?'· <b>'+moeda(a.valor)+'</b>':''}
      ${a.prazo?'<div class="auto-exig"><b>Prazo:</b> '+esc(a.prazo)+'</div>':''}
      ${a.exigencia?'<div class="auto-exig"><b>Motivo:</b> '+esc(a.exigencia)+'</div>':''}
      ${state.isAdmin?`<div class="acoes-status" style="margin-top:6px">
        <button class="btn btn-sec btn-sm js-valor-auto" data-id="${a.id}" data-v="${a.valor??''}">💰 ${a.valor!=null?'Editar valor':'Valor da multa'}</button>
        ${!a.resolvido?`<button class="btn btn-ok btn-sm js-resolver" data-id="${a.id}">Resolver</button>`:''}</div>`:''}</div>`).join('')
    : '<span class="card-end">Nenhum auto encontrado. O coletor checa o e-SCI a cada 2 dias.</span>';
  html+=`</div>`;
  if(re.ultima_verificacao) html+=`<p class="det-sub">Última checagem do e-SCI: ${new Date(re.ultima_verificacao).toLocaleString('pt-BR')}</p>`;
  if(state.isAdmin) html+=`<div class="form-acoes"><button class="btn btn-ghost" id="re-del">Excluir RE</button><button class="btn btn-sec" id="re-edit">Editar RE</button></div>`;
  abrirModal(html);
  $('#re-func') && ($('#re-func').onclick=async()=>{ const v=prompt('Data de emissão do último funcionamento (AAAA-MM-DD):', re.funcionamento_data||''); if(v===null)return; await sb.from('monitor_res').update({funcionamento_data:v.trim()||null}).eq('id',re.id); await carregarMonitor(); abrirRE(re.id); toast('Funcionamento atualizado.'); });
  $('#re-manut') && ($('#re-manut').onclick=async()=>{ await sb.from('monitor_res').update({ultima_manutencao:new Date().toISOString().slice(0,10)}).eq('id',re.id); await carregarMonitor(); abrirRE(re.id); toast('Manutenção registrada (hoje).'); });
  $('#re-manut-data') && ($('#re-manut-data').onclick=async()=>{ const v=prompt('Data da última manutenção (AAAA-MM-DD):', re.ultima_manutencao||''); if(v===null)return; await sb.from('monitor_res').update({ultima_manutencao:v.trim()||null}).eq('id',re.id); await carregarMonitor(); abrirRE(re.id); });
  $('#re-edit') && ($('#re-edit').onclick=()=>formRE(cli.id, re));
  $('#re-del') && ($('#re-del').onclick=async()=>{ if(!confirm('Excluir esta RE?'))return; await sb.from('monitor_res').delete().eq('id',re.id); await carregarMonitor(); fecharModal(); toast('RE excluída.'); });
  document.querySelectorAll('.js-resolver').forEach(b=>b.onclick=async()=>{ await sb.from('monitor_autos').update({resolvido:true,novo:false}).eq('id',b.dataset.id); await carregarMonitor(); abrirRE(re.id); toast('Auto resolvido.'); });
  document.querySelectorAll('.js-valor-auto').forEach(b=>b.onclick=async()=>{
    const v=prompt('Valor da multa (R$):', b.dataset.v||'');
    if(v===null) return;
    const val = v.trim()===''?null:_valorBR(v.replace(/[r$\s]/gi,''));
    if(val!==null && isNaN(val)){ toast('Valor inválido.',true); return; }
    const {error}=await sb.from('monitor_autos').update({valor:val}).eq('id',b.dataset.id);
    if(error){ toast(error.message,true); return; }
    await carregarMonitor(); abrirRE(re.id); toast('Valor salvo.');
  });
}

/* =====================================================================
   MÓDULO ORÇAMENTOS — follow-up de propostas comerciais
   Funil: Em aberto (a orçar / enviado) -> Ganho (vira obra) | Perdido (motivo)
   Rolling de 7 dias: (ultimo_contato | enviado_em) + intervalo_dias
   ===================================================================== */
const ORC_STATUS = {
  orcar:   { label:'A orçar',  cls:'orc-orcar' },
  enviado: { label:'Enviado',  cls:'orc-enviado' },
  ganho:   { label:'✅ Fechado', cls:'orc-ganho' },
  perdido: { label:'Perdido',  cls:'orc-perdido' },
};
const MOTIVO_PERDA = {
  preco:        'Preço',
  demora:       'Demora no orçamento',
  sem_resposta: 'Sem resposta do cliente',
  concorrencia: 'Fechou com concorrente',
  desistiu:     'Desistiu da obra',
  outro:        'Outro',
};
const ORC_INTERVALO = 7;
// Ícone oficial do WhatsApp (glifo) para os botões
const WA_ICON = '<svg viewBox="0 0 32 32" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M16 3C9.4 3 4 8.4 4 15c0 2.6.85 5.05 2.3 7.04L4.05 29l7.16-2.33A11.9 11.9 0 0 0 16 27c6.6 0 12-5.4 12-12S22.6 3 16 3zm0 21.8c-1.77 0-3.42-.52-4.82-1.4l-.34-.22-4.18 1.36 1.36-4.07-.23-.35A9.74 9.74 0 0 1 6.2 15c0-5.4 4.4-9.8 9.8-9.8s9.8 4.4 9.8 9.8-4.4 9.8-9.8 9.8zm5.36-7.33c-.29-.15-1.72-.85-1.99-.95-.27-.1-.46-.15-.66.15-.2.29-.76.94-.93 1.14-.17.2-.34.22-.63.07-.29-.15-1.23-.45-2.34-1.44-.86-.77-1.45-1.72-1.62-2.01-.17-.29-.02-.45.13-.59.13-.13.29-.34.43-.51.15-.17.19-.29.29-.49.1-.2.05-.37-.02-.51-.07-.15-.66-1.58-.9-2.17-.24-.57-.48-.49-.66-.5l-.56-.01c-.2 0-.51.07-.78.36-.27.29-1.02 1-1.02 2.43s1.05 2.82 1.19 3.01c.15.2 2.05 3.13 4.96 4.39.69.3 1.23.48 1.65.61.69.22 1.32.19 1.82.12.56-.09 1.72-.7 1.96-1.38.24-.68.24-1.26.17-1.38-.07-.12-.26-.2-.55-.34z"/></svg>';

function orcBase(o){ return o.ultimo_contato || o.enviado_em; }
function orcProxFollow(o){ const b=orcBase(o); if(!b) return null; const d=new Date(b); d.setDate(d.getDate()+(o.intervalo_dias||ORC_INTERVALO)); d.setHours(0,0,0,0); return d; }
function orcFollowInfo(o){
  if(o.status!=='enviado') return null;
  const p=orcProxFollow(o); if(!p) return null;
  const h=new Date(); h.setHours(0,0,0,0);
  const dias=Math.round((p-h)/86400000);
  if(dias<0)  return { dias, cls:'vermelho', txt:`follow-up atrasado ${-dias}d`, prox:p };
  if(dias===0) return { dias, cls:'vermelho', txt:'follow-up hoje', prox:p };
  if(dias<=2) return { dias, cls:'ambar',   txt:`follow-up em ${dias}d`, prox:p };
  return { dias, cls:'verde', txt:`follow-up em ${dias}d`, prox:p };
}
function msgFollowWhats(o){
  const nome = o.contato_nome ? ' '+o.contato_nome.split(' ')[0] : '';
  const orc  = o.orcamento_qs ? ' ('+o.orcamento_qs+')' : '';
  return `Olá${nome}! Aqui é da Rodrigues Preventivos 🧯\n`+
    `Passando para saber se você conseguiu analisar o orçamento${orc} que enviamos. `+
    `Ficamos à disposição para tirar dúvidas e ajustar o que for preciso para fecharmos juntos. Podemos seguir?`;
}

/* ---------- navegação / busca / filtros ---------- */
$('#abas-orc') && $('#abas-orc').addEventListener('click', e=>{
  const b=e.target.closest('.aba'); if(!b) return;
  state.abaOrc=b.dataset.abao;
  $('#abas-orc').querySelectorAll('.aba').forEach(a=>a.classList.toggle('ativa', a===b));
  renderOrcamentos();
});
$('#busca-orc') && $('#busca-orc').addEventListener('input', e=>{ state.buscaOrc=e.target.value.toLowerCase(); renderOrcamentos(); });
$('#btn-novo-orc') && $('#btn-novo-orc').addEventListener('click', ()=>formOrc(null));

const ORC_ABA_STATUS = { pendente:'orcar', aberto:'enviado', ganho:'ganho', perdido:'perdido' };
function orcContadores(){
  const c={ orcar:0, enviado:0, ganho:0, perdido:0 };
  state.orcamentos.forEach(o=>{ if(c[o.status]!=null) c[o.status]++; });
  $('#num-orc-pendente') && ($('#num-orc-pendente').textContent = c.orcar||'');
  $('#num-orc-aberto').textContent = c.enviado||'';
  $('#num-orc-ganho').textContent  = c.ganho||'';
  $('#num-orc-perdido').textContent = c.perdido||'';
}
function renderFiltrosOrc(){
  const wrap=$('#filtros-orc'); if(!wrap) return;
  if(state.abaOrc!=='aberto'){ wrap.innerHTML=''; return; }
  const def=[['todos','Todos'],['contato','Para contatar']];
  wrap.innerHTML = def.map(([k,l])=>`<button class="chip-filtro ${state.filtroOrc===k?'ativo':''}" data-f="${k}">${l}</button>`).join('');
  wrap.querySelectorAll('.chip-filtro').forEach(c=>c.onclick=()=>{ state.filtroOrc=c.dataset.f; renderFiltrosOrc(); renderListaOrc(); });
}
function renderOrcamentos(){
  if(!$('#lista-orc')) return;
  orcContadores(); renderFiltrosOrc(); renderListaOrc();
}
function renderListaOrc(){
  const el=$('#lista-orc'), vazio=$('#orc-vazio');
  if(state.orcErro){
    el.innerHTML=`<div class="vazio">Módulo indisponível — rode a migração <code>sql/migracao_orcamentos.sql</code> no Supabase.<br><small>${esc(state.orcErro)}</small></div>`;
    vazio.classList.add('hidden'); return;
  }
  let arr=state.orcamentos.filter(o=>o.status===ORC_ABA_STATUS[state.abaOrc]);
  if(state.abaOrc==='aberto' && state.filtroOrc==='contato') arr=arr.filter(o=>orcFollowInfo(o)?.dias<=0);
  if(state.buscaOrc){ const q=state.buscaOrc; arr=arr.filter(o=>(o.cliente+' '+(o.origem||'')+' '+(o.orcamento_qs||'')+' '+(o.contato_nome||'')).toLowerCase().includes(q)); }
  // ordena: pendentes os mais antigos primeiro; em aberto por follow-up mais urgente; fechados/perdidos por data desc
  if(state.abaOrc==='aberto'){
    arr.sort((a,b)=> (orcFollowInfo(a)?.dias??1e8)-(orcFollowInfo(b)?.dias??1e8));
  } else if(state.abaOrc==='pendente'){
    arr.sort((a,b)=> new Date(a.criado_em||0)-new Date(b.criado_em||0));
  } else {
    arr.sort((a,b)=> new Date(b.ganho_em||b.perdido_em||b.criado_em||0)-new Date(a.ganho_em||a.perdido_em||a.criado_em||0));
  }
  el.innerHTML = arr.map(cardOrc).join('');
  vazio.classList.toggle('hidden', arr.length>0);
  ligarCardsOrc();
}
function cardOrc(o){
  const f=orcFollowInfo(o);
  const st=ORC_STATUS[o.status]||{label:o.status,cls:''};
  const nItens=(o.orcamento_itens||[]).length;
  const linhaFollow = f ? `<div class="card-prazo">⏱ <span class="dias urg-${f.cls}">${f.txt}</span>
      <small>próx. ${dataBR(_iso(f.prox))}</small></div>` : '';
  const valor = o.valor_total!=null ? `<div class="card-or">${moeda(o.valor_total)}</div>` : '';
  let acoes='';
  if(o.status==='orcar'){
    acoes=`<button class="btn btn-ok btn-sm js-enviado" data-id="${o.id}">✓ Feito + enviado</button>`;
  } else if(o.status==='enviado'){
    acoes=`${o.telefone?`<button class="btn btn-wa btn-sm js-wa" data-id="${o.id}">${WA_ICON} WhatsApp</button>`:''}
      <button class="btn btn-primary btn-sm js-contato" data-id="${o.id}">📞 Contato / resultado</button>`;
  } else if(o.status==='perdido'){
    acoes=`<span class="cob-badge orc-perdido">${esc(MOTIVO_PERDA[o.motivo_perda_tipo]||'Perdido')}</span>`;
  } else if(o.status==='ganho'){
    acoes=`<span class="cob-badge orc-ganho">${o.obra_id?'virou obra ✓':'fechado'}</span>`;
  }
  return `<div class="card-obra" data-id="${o.id}">
    <div class="card-topo">
      <div><div class="card-cliente">${esc(o.cliente)}</div>
        ${o.origem?`<div class="card-end">origem: ${esc(o.origem)}</div>`:''}
        ${o.orcamento_qs?`<div class="card-or">Orç. ${esc(o.orcamento_qs)}</div>`:''}
        ${valor}</div>
      <span class="status-badge ${st.cls}">${st.label}</span>
    </div>
    ${linhaFollow}
    ${nItens?`<div class="card-equipe"><b>${nItens}</b> material(is) do QS</div>`:''}
    <div class="card-rodape">${acoes}</div>
  </div>`;
}
function ligarCardsOrc(){
  $('#lista-orc').querySelectorAll('.card-obra').forEach(c=>{
    c.querySelector('.js-enviado')?.addEventListener('click', ev=>{ ev.stopPropagation(); marcarEnviadoOrc(c.dataset.id); });
    c.querySelector('.js-wa')?.addEventListener('click', ev=>{ ev.stopPropagation(); whatsappOrc(c.dataset.id); });
    c.querySelector('.js-contato')?.addEventListener('click', ev=>{ ev.stopPropagation(); dialogContato(c.dataset.id); });
    c.addEventListener('click', ()=> abrirOrc(c.dataset.id));
  });
}

/* ---------- detalhe ---------- */
function abrirOrc(id){
  const o=state.orcamentos.find(x=>x.id===id); if(!o) return;
  const f=orcFollowInfo(o); const st=ORC_STATUS[o.status]||{label:o.status,cls:''};
  const itens=(o.orcamento_itens||[]).slice().sort((a,b)=>(a.ordem||0)-(b.ordem||0));
  let html=`<h2>${esc(o.cliente)}</h2>
    <div class="det-sub"><span class="status-badge ${st.cls}">${st.label}</span>
      ${f?`<span class="dias urg-${f.cls}" style="margin-left:6px">${f.txt}</span>`:''}</div>`;

  html+=`<div class="det-sec"><h3>Dados</h3>
    ${o.origem?linha('Origem',esc(o.origem)):''}
    ${o.contato_nome?linha('Contato',esc(o.contato_nome)):''}
    ${o.telefone?linha('Telefone',esc(o.telefone)):''}
    ${o.orcamento_qs?linha('Orçamento QS',esc(o.orcamento_qs)):''}
    ${o.valor_total!=null?linha('Valor total',moeda(o.valor_total)):''}
    ${o.responsavel?linha('Responsável',esc(o.responsavel)):''}
    ${o.enviado_em?linha('Enviado em',new Date(o.enviado_em).toLocaleDateString('pt-BR')):''}
    ${o.ultimo_contato?linha('Último contato',new Date(o.ultimo_contato).toLocaleDateString('pt-BR')):''}
    ${f?linha('Próximo follow-up',dataBR(_iso(f.prox))):''}
    ${o.status==='perdido'?linha('Motivo da perda',`<b>${esc(MOTIVO_PERDA[o.motivo_perda_tipo]||'—')}</b>${o.motivo_perda?' — '+esc(o.motivo_perda):''}`):''}</div>`;

  // ações de funil
  let botoes='';
  if(o.status==='orcar') botoes+=`<button class="btn btn-ok btn-sm" id="oc-enviado">✓ Feito + enviado ao cliente</button>`;
  if(o.status==='enviado'){
    if(o.telefone) botoes+=`<button class="btn btn-wa btn-sm" id="oc-wa">${WA_ICON} WhatsApp + mensagem</button>`;
    botoes+=`<button class="btn btn-primary btn-sm" id="oc-contato">📞 Registrar contato / resultado</button>`;
  }
  if(o.status==='ganho'||o.status==='perdido') botoes+=`<button class="btn btn-sec btn-sm" id="oc-reabrir">↩ Reabrir (voltar p/ aberto)</button>`;
  if(botoes) html+=`<div class="det-sec"><h3>Ações</h3><div class="acoes-status">${botoes}</div></div>`;

  // materiais
  html+=`<div class="det-sec"><h3>Materiais do QS (${itens.length})</h3>`;
  html+= itens.length ? `<table class="tabela"><tr><th>Material</th><th>Qtd</th><th>Un.</th></tr>
    ${itens.map(i=>`<tr><td>${esc(i.produto)}</td><td>${Number(i.quantidade).toLocaleString('pt-BR')}</td><td>${esc(i.unidade||'')}</td></tr>`).join('')}</table>`
    : '<span class="card-end">Nenhum material. Use o formulário (importar do Quanto Sobra) ou edite.</span>';
  html+=`</div>`;

  // observações
  html+=`<div class="det-sec"><h3>Observações</h3>
    <div class="obs-box">${o.observacoes?esc(o.observacoes):'<span class="card-end">Sem observações.</span>'}</div></div>`;

  // anexos
  html+=`<div class="det-sec"><h3>Arquivos (projeto / Quanto Sobra)</h3>
    <div id="oc-anexos">carregando…</div>
    <button class="btn btn-sec btn-sm" id="oc-up-anexo" style="margin-top:8px">📎 Anexar arquivo</button>
    <input type="file" id="oc-anexo-input" class="hidden"></div>`;

  // histórico
  html+=`<div class="det-sec"><h3>Histórico de contatos</h3><div id="oc-contatos">carregando…</div></div>`;

  // rodapé
  html+=`<div class="form-acoes"><button class="btn btn-ghost" id="oc-excluir">Excluir</button>
    <button class="btn btn-sec" id="oc-editar">Editar</button></div>`;

  abrirModal(html);
  $('#oc-enviado') && ($('#oc-enviado').onclick=()=>marcarEnviadoOrc(o.id));
  $('#oc-wa') && ($('#oc-wa').onclick=()=>whatsappOrc(o.id));
  $('#oc-contato') && ($('#oc-contato').onclick=()=>dialogContato(o.id));
  $('#oc-reabrir') && ($('#oc-reabrir').onclick=()=>reabrirOrc(o));
  $('#oc-editar').onclick=()=>formOrc(o);
  $('#oc-excluir').onclick=()=>excluirOrc(o);
  $('#oc-up-anexo').onclick=()=>$('#oc-anexo-input').click();
  $('#oc-anexo-input').onchange=e=>uploadAnexoOrc(o, e.target.files[0]);
  carregarAnexosOrc(o.id);
  carregarContatosOrc(o.id);
}

async function carregarContatosOrc(id){
  const el=$('#oc-contatos'); if(!el) return;
  const { data }=await sb.from('orcamento_contatos').select('*').eq('orcamento_id',id).order('criado_em',{ascending:false}).limit(20);
  el.innerHTML = (data&&data.length) ? data.map(c=>`<div class="log-item">${c.canal?`<span class="chip-serv">${esc(c.canal)}</span> `:''}<b>${esc(c.usuario_nome||'—')}</b>${c.observacao?' — '+esc(c.observacao):''} <small>(${new Date(c.criado_em).toLocaleString('pt-BR')})</small></div>`).join('') : '<span class="card-end">Sem contatos registrados.</span>';
}
async function contatoLog(orcamento_id, canal, observacao){
  await sb.from('orcamento_contatos').insert({ orcamento_id, canal, observacao, usuario_nome:state.perfil?.nome||state.user.email });
}

/* ---------- ações de funil ---------- */
async function salvarOrcCampos(id, campos){ const {error}=await sb.from('orcamentos').update(campos).eq('id',id); if(error){toast(error.message,true);return false;} await carregarTudo(true); return true; }

async function marcarEnviadoOrc(id){
  const o=state.orcamentos.find(x=>x.id===id); if(!o) return;
  const agora=new Date(); const prox=new Date(agora); prox.setDate(prox.getDate()+ORC_INTERVALO);
  const ok=await salvarOrcCampos(id,{ status:'enviado', enviado_em:o.enviado_em||agora.toISOString(),
    ultimo_contato:null, proximo_followup:_iso(prox) });
  if(!ok) return;
  await contatoLog(id,'sistema','Orçamento marcado como FEITO e ENVIADO ao cliente — follow-up em 7 dias.');
  await carregarTudo(true); toast('Marcado como enviado. Follow-up em 7 dias. ✓');
  if(state.modalAberto) abrirOrc(id);
}
function whatsappOrc(id){
  const o=state.orcamentos.find(x=>x.id===id); if(!o) return;
  const txt=msgFollowWhats(o); const l=waLink(o.telefone,txt);
  if(!l){ toast('Sem telefone cadastrado.',true); return; }
  try{ navigator.clipboard.writeText(txt); }catch(e){}
  window.open(l,'_blank');
  toast('WhatsApp aberto — mensagem já copiada.');
}

function dialogContato(id){
  const o=state.orcamentos.find(x=>x.id===id); if(!o) return;
  abrirModal(`<h2>${esc(o.cliente)}</h2>
    <p class="det-sub">Follow-up — o que aconteceu no contato?</p>
    ${o.telefone?`<div class="det-sec"><button class="btn btn-wa btn-sm" id="dc-wa">${WA_ICON} Abrir WhatsApp com a mensagem pronta</button></div>`:''}
    <div class="det-sec"><h3>Falei com o cliente — segue negociando</h3>
      <label class="campo" style="margin-bottom:8px">Canal
        <select id="dc-canal"><option value="whatsapp">WhatsApp</option><option value="ligacao">Ligação</option><option value="email">E-mail</option><option value="presencial">Presencial</option><option value="outro">Outro</option></select></label>
      <textarea id="dc-obs" class="campo" style="width:100%;min-height:70px;font-family:inherit" placeholder="O que o cliente falou? (opcional)"></textarea>
      <button class="btn btn-primary" id="dc-reg" style="margin-top:8px">✅ Registrei contato (reinicia os 7 dias)</button></div>
    <div class="det-sec"><h3>Resultado</h3><div class="acoes-status">
      <button class="btn btn-ok btn-sm" id="dc-ganho">✅ Fechou conosco (vira obra)</button>
      <button class="btn btn-aviso btn-sm" id="dc-perdido">❌ Fechou com outro / desistiu</button></div></div>
    <div class="form-acoes"><button class="btn btn-ghost" id="dc-volta">Voltar</button></div>`);
  $('#dc-wa') && ($('#dc-wa').onclick=()=>whatsappOrc(o.id));
  $('#dc-volta').onclick=()=>abrirOrc(o.id);
  $('#dc-reg').onclick=async()=>{
    const agora=new Date(); const prox=new Date(agora); prox.setDate(prox.getDate()+ORC_INTERVALO);
    const ok=await salvarOrcCampos(o.id,{ status:'enviado', enviado_em:o.enviado_em||agora.toISOString(),
      ultimo_contato:agora.toISOString(), proximo_followup:_iso(prox) });
    if(!ok) return;
    await contatoLog(o.id, $('#dc-canal').value, $('#dc-obs').value.trim()||'Contato registrado.');
    await carregarTudo(true); toast('Contato registrado. Reiniciou os 7 dias. ✓'); abrirOrc(o.id);
  };
  $('#dc-ganho').onclick=()=>ganharOrc(o);
  $('#dc-perdido').onclick=()=>dialogPerda(o);
}

async function ganharOrc(o){
  const ok=await salvarOrcCampos(o.id,{ status:'ganho', ganho_em:new Date().toISOString(), proximo_followup:null });
  if(!ok) return;
  await contatoLog(o.id,'sistema','✅ Cliente fechou conosco — orçamento FECHADO.');
  // joga AUTOMÁTICO para Obras (só admin tem permissão de escrever em obras)
  if(state.isAdmin && !o.obra_id){
    await criarObraDeOrcamento(o);   // já recarrega, dá toast e reabre o detalhe
  } else {
    await carregarTudo(true);
    toast(state.isAdmin ? 'Fechado! 🏆' : 'Fechado! 🏆 (um admin vai lançar como obra)');
    if(state.modalAberto) abrirOrc(o.id);
  }
}
async function criarObraDeOrcamento(o){
  const dados={ cliente:o.cliente, telefone_cliente:o.telefone||null, orcamento_qs:o.orcamento_qs||null,
    observacoes:o.observacoes||null, equipe_sugerida:[], equipe_confirmada:[] };
  const { data, error }=await sb.from('obras').insert(dados).select('id').single();
  if(error){ toast('Não consegui criar a obra: '+error.message, true); return; }
  const oid=data.id;
  const itens=(o.orcamento_itens||[]);
  if(itens.length) await sb.from('obra_itens').insert(itens.map((i,ix)=>({ obra_id:oid, produto:i.produto, quantidade:i.quantidade, unidade:i.unidade||null, ordem:ix })));
  await sb.from('obra_financeiro').upsert({ obra_id:oid, valor_total:o.valor_total??null, status_cobranca:'nao_aplicavel' });
  await sb.from('orcamentos').update({ obra_id:oid }).eq('id',o.id);
  await logar(oid,'criação','Veio do orçamento fechado de '+o.cliente);
  await carregarTudo(true); toast('Fechado e lançado como obra! ✓ Veja na aba Obras (defina serviços, equipe e prazo).');
  if(state.modalAberto) abrirOrc(o.id);
}

function dialogPerda(o){
  abrirModal(`<h2>Orçamento perdido — ${esc(o.cliente)}</h2>
    <p class="det-sub">Por que o cliente não fechou conosco? (vai para a aba Perdidos)</p>
    <div class="det-sec"><div class="equipe-pick">
      ${Object.entries(MOTIVO_PERDA).map(([k,v],i)=>`<label class="pessoa-chip"><input type="radio" name="motivo" value="${k}" ${i===0?'checked':''} style="margin-right:5px">${v}</label>`).join('')}</div>
      <textarea id="perda-obs" class="campo" style="width:100%;min-height:80px;font-family:inherit;margin-top:8px" placeholder="Detalhe (ex.: concorrente cobrou 20% menos; achou caro o SHP; sumiu depois do envio...)"></textarea></div>
    <div class="form-acoes"><button class="btn btn-ghost" id="perda-volta">Voltar</button>
      <button class="btn btn-aviso" id="perda-salva">Confirmar perda</button></div>`);
  $('#perda-volta').onclick=()=>abrirOrc(o.id);
  $('#perda-salva').onclick=async()=>{
    const tipo=document.querySelector('input[name=motivo]:checked')?.value||'outro';
    const obs=$('#perda-obs').value.trim()||null;
    const ok=await salvarOrcCampos(o.id,{ status:'perdido', perdido_em:new Date().toISOString(),
      motivo_perda_tipo:tipo, motivo_perda:obs, proximo_followup:null });
    if(!ok) return;
    await contatoLog(o.id,'sistema',`❌ Perdido — ${MOTIVO_PERDA[tipo]}${obs?': '+obs:''}`);
    await carregarTudo(true); toast('Movido para Perdidos.'); abrirOrc(o.id);
  };
}
async function reabrirOrc(o){
  if(!confirm('Reabrir este orçamento (volta para "Em aberto" como enviado)?')) return;
  const agora=new Date(); const prox=new Date(agora); prox.setDate(prox.getDate()+ORC_INTERVALO);
  const ok=await salvarOrcCampos(o.id,{ status:'enviado', ganho_em:null, perdido_em:null,
    motivo_perda_tipo:null, motivo_perda:null, ultimo_contato:agora.toISOString(), proximo_followup:_iso(prox) });
  if(!ok) return;
  await contatoLog(o.id,'sistema','↩ Reaberto.');
  await carregarTudo(true); toast('Reaberto.'); abrirOrc(o.id);
}
async function excluirOrc(o){
  if(!confirm(`Excluir o orçamento de "${o.cliente}"? Não dá pra desfazer.`)) return;
  const {error}=await sb.from('orcamentos').delete().eq('id',o.id);
  if(error){toast(error.message,true);return;}
  fecharModal(); await carregarTudo(true); toast('Orçamento excluído.');
}

/* ---------- anexos do orçamento (bucket projetos, prefixo orcamentos/) ---------- */
async function carregarAnexosOrc(id){
  const el=$('#oc-anexos'); if(!el) return;
  const { data, error }=await sb.from('orcamento_anexos').select('*').eq('orcamento_id',id).order('criado_em');
  if(error){ el.innerHTML='<span class="card-end">Indisponível — rode a migração.</span>'; return; }
  if(!data||!data.length){ el.innerHTML='<span class="card-end">Nenhum arquivo.</span>'; return; }
  el.innerHTML=data.map(a=>`<div class="anexo-item"><a href="#" class="js-ver-oc-anexo" data-p="${esc(a.path)}">📄 ${esc(a.nome)}</a>
    ${a.tipo==='quanto_sobra'?'<small>QS</small>':''}
    <button class="x-row js-del-oc-anexo" data-id="${a.id}" data-p="${esc(a.path)}" title="Excluir">×</button></div>`).join('');
  el.querySelectorAll('.js-ver-oc-anexo').forEach(x=>x.onclick=ev=>{ev.preventDefault(); verAnexo(x.dataset.p);});
  el.querySelectorAll('.js-del-oc-anexo').forEach(x=>x.onclick=()=>excluirAnexoOrc(id, x.dataset.id, x.dataset.p));
}
async function uploadAnexoOrc(o, file, tipo){
  if(!file) return; toast('Enviando arquivo…');
  const path=`orcamentos/${o.id}/${Date.now()}_${file.name.replace(/[^\w.\-]/g,'_')}`;
  const { error }=await sb.storage.from('projetos').upload(path, file);
  if(error){ toast('Erro no upload: '+error.message, true); return; }
  const { error:e2 }=await sb.from('orcamento_anexos').insert({ orcamento_id:o.id, nome:file.name, path,
    mime:file.type||null, tamanho:file.size||null, tipo:tipo||'outro', criado_por_nome:state.perfil?.nome||state.user.email });
  if(e2){ toast('Erro: '+e2.message, true); return; }
  toast('Arquivo anexado.'); if(state.modalAberto) carregarAnexosOrc(o.id);
}
async function excluirAnexoOrc(orcId, id, path){
  if(!confirm('Excluir este arquivo?')) return;
  await sb.storage.from('projetos').remove([path]);
  await sb.from('orcamento_anexos').delete().eq('id',id);
  carregarAnexosOrc(orcId); toast('Arquivo removido.');
}

/* ---------- import do Quanto Sobra (PDF -> valor total + materiais) ---------- */
let _qsFilePend=null;  // arquivo importado, anexado após salvar
function carregarPdfJs(){
  if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
    s.onload=()=>{ window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'; res(window.pdfjsLib); };
    s.onerror=()=>rej(new Error('Não consegui carregar o leitor de PDF (precisa de internet).'));
    document.head.appendChild(s);
  });
}
async function lerLinhasPdf(file){
  const lib=await carregarPdfJs();
  const buf=await file.arrayBuffer();
  const pdf=await lib.getDocument({data:buf}).promise;
  const linhas=[];
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p); const tc=await page.getTextContent();
    let linha='';
    for(const it of tc.items){ linha+=it.str+' '; if(it.hasEOL){ linhas.push(linha.trim()); linha=''; } }
    if(linha.trim()) linhas.push(linha.trim());
  }
  return linhas;
}
function _valorBR(s){ return parseFloat(String(s).replace(/\./g,'').replace(',','.')); }
function _ultimoValor(s){ const m=[...String(s).matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2})/g)]; return m.length?_valorBR(m[m.length-1][1]):null; }
// Lê o PDF do Quanto Sobra no layout REAL:
//   cabeçalho da empresa · "Dados do Cliente" + nome · tabela
//   "Item Código Descrição T Qtd. Unid. Valor Un. Total" (T = P produto / S serviço)
//   · linhas "Totais ... 6.001,20" (total geral, sem R$).
function extrairQS(linhas){
  const L = linhas.map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
  const out = { cliente:null, orcamento_qs:null, total:null, itens:[] };

  // Nº do orçamento -> ORxxx
  for(const l of L){ const m=l.match(/or[çc]amento\s*n?[ºo°.]*\s*(\d{1,6})/i); if(m){ out.orcamento_qs='OR'+m[1]; break; } }

  // Cliente: primeira linha "de verdade" depois de "Dados do Cliente"
  const ic = L.findIndex(l=>/dados\s+do\s+cliente/i.test(l));
  if(ic>=0){ for(let k=ic+1;k<L.length;k++){ const c=L[k].trim();
    if(c && !/produtos\s+e\s+servi/i.test(c)){ out.cliente=c; break; } } }

  // Total geral = valor da linha "Totais Produtos/Serviços" (fallbacks)
  const lt = L.find(l=>/totais\s+produtos\s*\/\s*servi/i.test(l))
          || L.find(l=>/^total\s+geral/i.test(l))
          || L.find(l=>/^totais\s+produtos\b/i.test(l));
  if(lt) out.total=_ultimoValor(lt);

  // Itens: SÓ PRODUTOS (T = P). Mão de obra (S) fica de fora. Para ao chegar nos "Totais".
  const reItem = /^(\d+)\s+(?:(\d{3,6})\s+)?(.+?)\s+([PS])\s+(\d+(?:[.,]\d+)?)\s+(?:([A-Za-zºª.]{1,6})\s+)?R\$\s*[\d.,]+\s+R\$\s*[\d.,]+$/i;
  for(const l of L){
    if(/^totais\b/i.test(l)) break;
    const m=l.match(reItem);
    if(m && m[4].toUpperCase()==='P'){
      out.itens.push({ produto:m[3].replace(/\s{2,}/g,' ').trim(), quantidade:_valorBR(m[5]), unidade:(m[6]||'').replace(/\.$/,'')||null });
    }
  }
  return out;
}

/* ---------- formulário novo / editar orçamento ---------- */
function orcItemRow(it){ return `<div class="item-row"><input class="oprod" placeholder="Material / produto" value="${esc(it?.produto||'')}">
  <input class="oqtd" type="number" step="0.001" placeholder="qtd" value="${it?.quantidade??''}">
  <input class="ouni" placeholder="un." value="${esc(it?.unidade||'')}">
  <button type="button" class="x-row js-rm-o">×</button></div>`; }
function ligarRemoverOrc(){ document.querySelectorAll('#form-orc .js-rm-o').forEach(b=>b.onclick=()=>b.parentElement.remove()); }

function formOrc(o){
  _qsFilePend=null;
  const ed=!!o;
  const itemRows=(o?.orcamento_itens||[]).sort((a,b)=>(a.ordem||0)-(b.ordem||0)).map(orcItemRow).join('') || orcItemRow(null);
  const mostraEnvio = !ed || o.status==='orcar';
  abrirModal(`<h2>${ed?'Editar orçamento':'Novo orçamento'}</h2>
    <form id="form-orc"><div class="form-grid">
      <label class="campo full">Cliente *<input name="cliente" required value="${esc(o?.cliente||'')}"></label>
      <label class="campo">Origem do lead<input name="origem" placeholder="indicação / site / leads CBMSC…" value="${esc(o?.origem||'')}"></label>
      <label class="campo">Responsável<input name="responsavel" value="${esc(o?.responsavel||state.perfil?.nome||'')}"></label>
      <label class="campo">Contato (nome)<input name="contato_nome" value="${esc(o?.contato_nome||'')}"></label>
      <label class="campo">Telefone / WhatsApp<input name="telefone" placeholder="(47) 9 9999-9999" value="${esc(o?.telefone||'')}"></label>
      <label class="campo">Orçamento QS<input name="orcamento_qs" placeholder="OR930" value="${esc(o?.orcamento_qs||'')}"></label>
      <label class="campo">Valor total (R$)<input type="number" step="0.01" name="valor_total" value="${o?.valor_total??''}"></label>
      ${mostraEnvio?`<label class="campo" style="flex-direction:row;align-items:center;gap:8px;font-weight:600"><input type="checkbox" name="ja_enviado" style="width:auto"> Já enviei ao cliente (inicia o follow-up de 7 dias)</label>`:''}
      <label class="campo full">Observações<textarea name="observacoes" rows="2">${esc(o?.observacoes||'')}</textarea></label>
    </div>

    <div class="det-sec"><h3>Quanto Sobra <small>— importa valor total e materiais de um PDF</small></h3>
      <button type="button" class="btn btn-sec btn-sm" id="orc-import">📎 Importar do Quanto Sobra (PDF)</button>
      <input type="file" id="orc-import-input" accept="application/pdf" class="hidden">
      <div id="orc-import-msg" class="det-sub" style="margin-top:6px"></div></div>

    <div class="det-sec"><h3>Materiais (viram a folha de obra quando ganhar)</h3><div id="orc-item-list">${itemRows}</div>
      <button type="button" class="mini-add" id="orc-add-item">+ adicionar material</button></div>

    <div class="form-acoes"><button type="button" class="btn btn-ghost" id="orc-cancela">Cancelar</button>
      <button type="submit" class="btn btn-primary">${ed?'Salvar alterações':'Criar orçamento'}</button></div>
    </form>`);

  $('#orc-add-item').onclick=()=>{ const d=document.createElement('div'); d.innerHTML=orcItemRow(null); $('#orc-item-list').appendChild(d.firstElementChild); ligarRemoverOrc(); };
  ligarRemoverOrc();
  $('#orc-cancela').onclick=()=> o?abrirOrc(o.id):fecharModal();
  $('#orc-import').onclick=()=>$('#orc-import-input').click();
  $('#orc-import-input').onchange=async e=>{
    const file=e.target.files[0]; if(!file) return;
    const msg=$('#orc-import-msg'); msg.textContent='Lendo PDF…';
    try{
      const linhas=await lerLinhasPdf(file);
      const qs=extrairQS(linhas);
      const ff=$('#form-orc');
      if(qs.cliente) ff.cliente.value=qs.cliente;
      if(qs.orcamento_qs) ff.orcamento_qs.value=qs.orcamento_qs;
      if(qs.total!=null) ff.valor_total.value=qs.total.toFixed(2);
      if(qs.itens.length){ $('#orc-item-list').innerHTML=qs.itens.map(orcItemRow).join(''); ligarRemoverOrc(); }
      _qsFilePend=file; // anexa após salvar
      const partes=[];
      if(qs.cliente) partes.push('Cliente: <b>'+esc(qs.cliente)+'</b>');
      if(qs.orcamento_qs) partes.push(esc(qs.orcamento_qs));
      if(qs.total!=null) partes.push('Valor '+moeda(qs.total));
      partes.push(qs.itens.length?('<b>'+qs.itens.length+'</b> materiais (confira!)'):'sem materiais — adicione à mão');
      msg.innerHTML='✓ '+partes.join(' · ')+'. O PDF será anexado ao salvar.';
    }catch(err){ msg.textContent='Não consegui ler o PDF: '+err.message; }
  };
  $('#form-orc').onsubmit=e=>{ e.preventDefault(); salvarOrc(o); };
}

async function salvarOrc(o){
  const f=$('#form-orc');
  const cliente=f.cliente.value.trim(); if(!cliente){ toast('Informe o cliente.',true); return; }
  const itens=[...document.querySelectorAll('#orc-item-list .item-row')].map((r,i)=>({
    produto:r.querySelector('.oprod').value.trim(),
    quantidade:+r.querySelector('.oqtd').value||0,
    unidade:r.querySelector('.ouni').value.trim()||null, ordem:i })).filter(i=>i.produto);
  const dados={ cliente, origem:f.origem.value.trim()||null, responsavel:f.responsavel.value.trim()||null,
    contato_nome:f.contato_nome.value.trim()||null, telefone:f.telefone.value.trim()||null,
    orcamento_qs:f.orcamento_qs.value.trim()||null,
    valor_total:f.valor_total.value!==''?+f.valor_total.value:null,
    observacoes:f.observacoes.value.trim()||null };

  // controle de "já enviado" (só quando estava a orçar / é novo)
  const jaEnviado = f.ja_enviado && f.ja_enviado.checked;
  if(jaEnviado && (!o || o.status==='orcar')){
    const agora=new Date(); const prox=new Date(agora); prox.setDate(prox.getDate()+ORC_INTERVALO);
    dados.status='enviado'; dados.enviado_em=o?.enviado_em||agora.toISOString(); dados.proximo_followup=_iso(prox);
  }
  if(!o){ dados.criado_por_nome=state.perfil?.nome||state.user.email; }

  let orcId=o?.id;
  if(o){ const {error}=await sb.from('orcamentos').update(dados).eq('id',o.id); if(error){toast(error.message,true);return;} }
  else { const {data,error}=await sb.from('orcamentos').insert(dados).select('id').single(); if(error){toast(error.message,true);return;} orcId=data.id; }

  await sb.from('orcamento_itens').delete().eq('orcamento_id',orcId);
  if(itens.length) await sb.from('orcamento_itens').insert(itens.map(i=>({...i, orcamento_id:orcId})));

  if(_qsFilePend){ await uploadAnexoOrc({id:orcId}, _qsFilePend, 'quanto_sobra'); _qsFilePend=null; }
  if(!o && jaEnviado) await contatoLog(orcId,'sistema','Orçamento cadastrado já como ENVIADO.');

  await carregarTudo(true); toast(o?'Orçamento atualizado.':'Orçamento criado.'); abrirOrc(orcId);
}

/* =====================================================================
   MÓDULO RENOVAÇÕES (pós-venda) — máquina de renovações do Henrique
   Clientes com obrigações que renovam (SHP anual, SDAI, extintores, SPDA, gás).
   ===================================================================== */
const RENOV_STATUS = {
  'Não contatado':  'st-renov-nao',
  'Rascunho criado':'st-renov-rasc',
  'Enviado':        'st-renov-env',
  'Em negociação':  'st-renov-neg',
  'Contratado':     'st-renov-contr',
  'Inativo':        'st-renov-inat',
};
const RENOV_STATUS_OPTS = Object.keys(RENOV_STATUS);
const RENOV_SISTEMAS = ['Hidrantes (SHP)','Alarme/SDAI','Detectores/SDAI','Iluminação de Emergência',
  'Extintores','SPDA','SPDA – Aterramento','Rede de Gás'];
const MESES_RENOV = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

// Textos normativos por sistema (portados do app do Henrique) — base do e-mail de renovação
const GRUPOS_EMAIL_RENOV = [
  { ids:['Hidrantes (SHP)'], titulo:'Sistema Hidráulico Preventivo (SHP) — Rede de Hidrantes',
    obrigacao:'O Art. 8º, §1º da Instrução Normativa 007/DAT/CBMSC exige a realização de manutenção anual do SHP, com emissão de Relatório Técnico (RT) assinado por Responsável Técnico habilitado e anotação de DRT junto ao CREA.',
    servicos:'ART de manutenção com laudo técnico, laudo de comissionamento do sistema e laudo de vazão.' },
  { ids:['Alarme/SDAI','Detectores/SDAI'], titulo:'Sistema de Detecção e Alarme de Incêndio (SDAI)',
    obrigacao:'O Art. 13, §2º, inciso I da Instrução Normativa 007/DAT/CBMSC exige relatório anual do SDAI abrangendo detectores e central, com emissão de DRT junto ao CREA.',
    servicos:'ART de manutenção com laudo técnico, laudo de comissionamento do sistema e laudo de sonoridade.' },
  { ids:['Iluminação de Emergência'], titulo:'Sistema de Iluminação de Emergência',
    obrigacao:'A Instrução Normativa 007/DAT/CBMSC exige verificação anual do sistema de iluminação de emergência, incluindo teste das baterias e blocos autônomos, com emissão de Relatório Técnico assinado por profissional habilitado.',
    servicos:'ART de manutenção com laudo técnico e laudo de luminosidade (medição em lux nos pontos exigidos pela norma).' },
  { ids:['Extintores'], titulo:'Extintores de Incêndio',
    obrigacao:'A NBR 12962 exige recarga e/ou revisão anual dos extintores. Extintores com prazo vencido ou próximo do vencimento devem ser substituídos ou recarregados para manter a validade do CVCO junto ao CBMSC.',
    servicos:'Fornecimento de extintores novos em substituição às unidades com prazo vencido ou a vencer. (Nota: recarga e manutenção de extintores não fazem parte do nosso escopo — recomendamos empresa especializada para esse procedimento.)' },
  { ids:['SPDA','SPDA – Aterramento'], titulo:'Sistema de Proteção contra Descargas Atmosféricas (SPDA)',
    obrigacao:'A ABNT NBR 5419 exige inspeção periódica do SPDA e do sistema de aterramento elétrico, com verificação do estado dos componentes, continuidade dos condutores e medição da resistência ôhmica, emitindo laudo técnico assinado por profissional habilitado.',
    servicos:'ART de inspeção e laudo de resistência ôhmica (medição com terrômetro).' },
  { ids:['Rede de Gás','Gás Canalizado'], titulo:'Rede de Gás Canalizado',
    obrigacao:'A NBR 15526 (gás natural) e a NBR 13523 (GLP) exigem manutenção periódica das instalações de gás, com teste de estanqueidade e emissão de laudo técnico por profissional habilitado.',
    servicos:'ART de manutenção com laudo técnico e laudo de estanqueidade da rede.' },
];

function diasAteRenov(v){ if(!v) return 999; const d=Math.round((new Date(v+'T00:00:00')-new Date().setHours(0,0,0,0))/86400000); return d; }
function fmtDataLongoRenov(s){ if(!s) return '—'; const [y,m,d]=s.split('-'); return `${+d} de ${MESES_RENOV[+m-1]} de ${y}`; }
function badgeDiasRenov(d, baixada){
  if(baixada) return `<span class="dias urg-cinza">baixada</span>`;
  if(d<0)  return `<span class="dias urg-vermelho">${Math.abs(d)}d atrasado</span>`;
  if(d<=7) return `<span class="dias urg-vermelho">${d}d</span>`;
  if(d<=30)return `<span class="dias urg-ambar">${d}d</span>`;
  if(d<=60)return `<span class="dias urg-ambar">${d}d</span>`;
  return `<span class="dias urg-verde">${d}d</span>`;
}

/* ---------- navegação / filtros ---------- */
$('#busca-renov') && $('#busca-renov').addEventListener('input', e=>{ state.buscaRenov=e.target.value.toLowerCase(); renderListaRenov(); });
$('#f-renov-dias') && $('#f-renov-dias').addEventListener('change', e=>{ state.fRenovDias=e.target.value; renderListaRenov(); });
$('#f-renov-status') && $('#f-renov-status').addEventListener('change', e=>{ state.fRenovStatus=e.target.value; renderListaRenov(); });
$('#f-renov-email') && $('#f-renov-email').addEventListener('change', e=>{ state.fRenovEmail=e.target.value; renderListaRenov(); });
$('#btn-novo-renov') && $('#btn-novo-renov').addEventListener('click', ()=>formRenov(null));

function renderRenovacoes(){ if(!$('#lista-renov')) return; statsRenov(); renderListaRenov(); }

function statsRenov(){
  const el=$('#renov-stats'); if(!el) return;
  const at=state.renovacoes.filter(c=>!c.baixada);
  const dd=c=>diasAteRenov(c.vencimento);
  const s={
    urgente: at.filter(c=>dd(c)>=0&&dd(c)<=7).length,
    vencendo:at.filter(c=>dd(c)>=0&&dd(c)<=30).length,
    total:   at.length,
    email:   at.filter(c=>c.email).length,
    contratado: at.filter(c=>c.status_contato==='Contratado').length,
    pendente:at.filter(c=>c.status_contato==='Não contatado'&&c.email).length,
  };
  const card=(num,lbl,cls)=>`<div class="renov-card"><div class="renov-num ${cls||''}">${num}</div><div class="renov-lbl">${lbl}</div></div>`;
  el.innerHTML = card(s.urgente,'urgente ≤7d','rojo')+card(s.vencendo,'vencendo ≤30d','ambar')+
    card(s.total,'total monitorados','')+card(s.email,'com e-mail','azul')+
    card(s.contratado,'contratados','verde')+card(s.pendente,'aguardando contato','info');
}

function renderListaRenov(){
  const el=$('#lista-renov'), vazio=$('#renov-vazio'); if(!el) return;
  if(state.renovErro){ el.innerHTML=`<div class="vazio">Módulo indisponível — rode <code>sql/migracao_renovacoes.sql</code> no Supabase.<br><small>${esc(state.renovErro)}</small></div>`; vazio.classList.add('hidden'); return; }
  const q=state.buscaRenov, fd=state.fRenovDias, fs=state.fRenovStatus, fe=state.fRenovEmail;
  let arr=state.renovacoes.filter(c=>{
    const d=diasAteRenov(c.vencimento);
    if(q && !(c.contratante||'').toLowerCase().includes(q) && !(c.cidade||'').toLowerCase().includes(q)) return false;
    if(fd==='venc'){ if(!(d<0)) return false; } else if(fd && d>+fd) return false;
    if(fs && c.status_contato!==fs) return false;
    if(fe==='sim' && !c.email) return false;
    if(fe==='nao' && c.email) return false;
    return true;
  });
  el.innerHTML = arr.map(cardRenov).join('');
  vazio.classList.toggle('hidden', arr.length>0 || !!state.renovErro);
  el.querySelectorAll('.card-renov').forEach(card=>{
    const id=card.dataset.id;
    card.querySelector('.js-renov-status')?.addEventListener('change', e=>mudarStatusRenov(id, e.target.value));
    card.querySelector('.js-renov-email')?.addEventListener('click', ()=>emailRenov(id));
    card.querySelector('.js-renov-wa')?.addEventListener('click', ()=>emailRenov(id, true));
    card.querySelector('.js-renov-edit')?.addEventListener('click', ()=>formRenov(state.renovacoes.find(x=>x.id===id)));
  });
}

function cardRenov(c){
  const d=diasAteRenov(c.vencimento);
  const chips=(c.sistemas||[]).map(s=>`<span class="sis-pill">${esc(s)}</span>`).join('');
  const stCls=RENOV_STATUS[c.status_contato]||'st-renov-nao';
  const opts=RENOV_STATUS_OPTS.map(s=>`<option ${s===c.status_contato?'selected':''}>${s}</option>`).join('');
  return `<div class="card-obra card-renov ${c.baixada||c.status_contato==='Inativo'?'renov-off':''}" data-id="${c.id}">
    <div class="card-topo">
      <div><div class="card-cliente">${esc(c.contratante)}</div>
        ${c.cidade?`<div class="card-end">${esc(c.cidade)}</div>`:''}
        <div class="card-prazo">⏱ ${badgeDiasRenov(d,c.baixada)} ${c.vencimento?`<small>vence ${dataBR(c.vencimento)}</small>`:'<small>sem vencimento</small>'}</div></div>
      <span class="status-badge ${stCls}">${esc(c.status_contato)}</span>
    </div>
    ${chips?`<div class="servicos-chips">${chips}</div>`:''}
    <div class="card-end" style="margin-top:4px">${c.email?'✉ '+esc(c.email):'<span style="opacity:.5">sem e-mail</span>'}${c.telefone?'  ·  📞 '+esc(c.telefone):''}</div>
    <div class="card-rodape" style="gap:6px;flex-wrap:wrap;align-items:center">
      <select class="js-renov-status mini-select">${opts}</select>
      ${!c.baixada&&c.email?`<button class="btn btn-sec btn-sm js-renov-email">✉ E-mail</button>`:''}
      ${!c.baixada&&c.telefone?`<button class="btn btn-wa btn-sm js-renov-wa">${WA_ICON} WhatsApp</button>`:''}
      <button class="btn btn-ghost btn-sm js-renov-edit">✏️ Editar</button>
    </div>
  </div>`;
}

async function mudarStatusRenov(id, status){
  const c=state.renovacoes.find(x=>x.id===id); if(!c) return;
  let campos={status_contato:status};
  let renovou=false;
  if(status==='Contratado'){
    // avança o vencimento 1 ano e volta p/ "Não contatado" (próximo ciclo)
    let base=c.vencimento?new Date(c.vencimento+'T00:00:00'):new Date();
    base.setFullYear(base.getFullYear()+1);
    campos.vencimento=base.toISOString().slice(0,10);
    campos.status_contato='Não contatado';
    renovou=true;
  }
  const {error}=await sb.from('renovacoes').update(campos).eq('id',id);
  if(error){ toast(error.message,true); return; }
  await carregarTudo(true);
  toast(renovou?'🎉 Contratado! Vencimento avançado +1 ano.':'Status: '+status);
}

function formRenov(c){
  const ed=!!c; const sel=new Set(c?.sistemas||[]);
  const sisChips=RENOV_SISTEMAS.map(s=>`<button type="button" class="pessoa-chip ${sel.has(s)?'sel':''}" data-s="${esc(s)}">${esc(s)}</button>`).join('');
  const stOpts=RENOV_STATUS_OPTS.map(s=>`<option ${s===(c?.status_contato||'Não contatado')?'selected':''}>${s}</option>`).join('');
  abrirModal(`<h2>${ed?'Editar cliente':'Novo cliente'}</h2>
    <form id="form-renov"><div class="form-grid">
      <label class="campo full">Contratante *<input name="contratante" required value="${esc(c?.contratante||'')}"></label>
      <label class="campo">CNPJ / CPF<input name="cnpj_cpf" value="${esc(c?.cnpj_cpf||'')}"></label>
      <label class="campo">Cidade<input name="cidade" value="${esc(c?.cidade||'')}"></label>
      <label class="campo full">Endereço da obra<input name="endereco" value="${esc(c?.endereco||'')}"></label>
      <label class="campo">E-mail<input type="email" name="email" value="${esc(c?.email||'')}"></label>
      <label class="campo">Telefone<input name="telefone" value="${esc(c?.telefone||'')}"></label>
      <label class="campo">Próximo vencimento<input type="date" name="vencimento" value="${c?.vencimento||''}"></label>
      <label class="campo">Status<select name="status_contato">${stOpts}</select></label>
      <label class="campo full">Observações<textarea name="observacoes" rows="2">${esc(c?.observacoes||'')}</textarea></label>
      <label class="campo full" style="flex-direction:row;align-items:center;gap:8px;font-weight:600"><input type="checkbox" name="baixada" ${c?.baixada?'checked':''} style="width:auto"> Empresa baixada / inativa na Receita</label>
    </div>
    <div class="det-sec"><h3>Sistemas (obrigações que renovam)</h3><div class="equipe-pick" id="renov-sis">${sisChips}</div></div>
    <div class="form-acoes">${ed?'<button type="button" class="btn btn-ghost" id="renov-del">Excluir</button>':''}
      <button type="button" class="btn btn-ghost" id="renov-cancel">Cancelar</button>
      <button type="submit" class="btn btn-primary">${ed?'Salvar':'Criar'}</button></div></form>`);
  $('#renov-sis').querySelectorAll('.pessoa-chip').forEach(b=>b.onclick=()=>b.classList.toggle('sel'));
  $('#renov-cancel').onclick=fecharModal;
  $('#renov-del') && ($('#renov-del').onclick=()=>excluirRenov(c));
  $('#form-renov').onsubmit=e=>{ e.preventDefault(); salvarRenov(c); };
}

async function salvarRenov(c){
  const f=$('#form-renov');
  const contratante=f.contratante.value.trim(); if(!contratante){ toast('Informe o contratante.',true); return; }
  const sistemas=[...$('#renov-sis').querySelectorAll('.sel')].map(b=>b.dataset.s);
  const dados={ contratante, cnpj_cpf:f.cnpj_cpf.value.trim()||null, cidade:f.cidade.value.trim()||null,
    endereco:f.endereco.value.trim()||null, email:f.email.value.trim()||null, telefone:f.telefone.value.trim()||null,
    vencimento:f.vencimento.value||null, status_contato:f.status_contato.value, sistemas,
    observacoes:f.observacoes.value.trim()||'', baixada:f.baixada.checked };
  const {error}= c ? await sb.from('renovacoes').update(dados).eq('id',c.id) : await sb.from('renovacoes').insert(dados);
  if(error){ toast(error.message,true); return; }
  fecharModal(); await carregarTudo(true); toast(c?'Cliente atualizado.':'Cliente adicionado.');
}
async function excluirRenov(c){
  if(!confirm(`Excluir "${c.contratante}" das renovações?`)) return;
  const {error}=await sb.from('renovacoes').delete().eq('id',c.id);
  if(error){ toast(error.message,true); return; }
  fecharModal(); await carregarTudo(true); toast('Cliente excluído.');
}

/* ---------- gerador de e-mail / WhatsApp (portado do app do Henrique) ---------- */
function gerarAssuntoRenov(nome){
  const stop=new Set(['de','do','da','dos','das','e','ltda','me','eireli','s/a','sa','epp','ltd']);
  const palavras=(nome||'').split(/\s+/).filter(w=>w && !stop.has(w.toLowerCase()))
    .map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase());
  return 'Renovação de Laudos e ARTs – '+palavras.slice(0,3).join(' ');
}
function foneWaRenov(tel){ const dig=soDigitos((tel||'').split('/')[0]); return (dig.length===10||dig.length===11)?'55'+dig:null; }
function gerarCorpoEmailRenov(c){
  const sis=new Set(c.sistemas||[]);
  const venc=fmtDataLongoRenov(c.vencimento||'');
  const localPartes=[c.endereco,c.cidade].filter(Boolean).join(', ');
  const local=localPartes?`, localizada em ${localPartes}`:'';
  let blocos=[];
  for(const g of GRUPOS_EMAIL_RENOV){ if(g.ids.some(id=>sis.has(id)))
    blocos.push(`>> ${g.titulo}\n  Obrigação: ${g.obrigacao}\n  O que podemos emitir/fornecer: ${g.servicos}`); }
  if(!blocos.length) blocos=['  (sistemas a confirmar — favor desconsiderar se já regularizados)'];
  return `Prezado(a),\n\nConforme nosso histórico de serviços, identificamos que a edificação${local} possui obrigações de renovação com vencimento previsto para ${venc}. Seguem os detalhes por sistema:\n\n${blocos.join('\n\n')}\n\nPara manter o Certificado de Vistoria do Corpo de Bombeiros (CVCO) em dia e evitar autuações do CBMSC, os documentos acima precisam ser emitidos dentro do prazo.\n\nPodemos agendar os serviços com antecedência — fico à disposição para qualquer dúvida ou para confirmarmos uma data.\n\nAtenciosamente,\nRodrigues Preventivos Ltda\n(47) 98821-3395 | henrique@rodriguespreventivos.com.br`;
}
function emailRenov(id, focoWa){
  const c=state.renovacoes.find(x=>x.id===id); if(!c) return;
  const assunto=gerarAssuntoRenov(c.contratante);
  const corpo=gerarCorpoEmailRenov(c);
  const wa=foneWaRenov(c.telefone);
  const gmail=`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(c.email||'')}&su=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
  const waUrl=wa?`https://wa.me/${wa}?text=${encodeURIComponent(corpo)}`:null;
  abrirModal(`<h2>Renovação — ${esc(c.contratante)}</h2>
    <div class="det-sub">${c.email?'Para: <b>'+esc(c.email)+'</b>':'<span style="color:var(--perigo)">sem e-mail cadastrado</span>'} · Assunto: ${esc(assunto)}</div>
    <pre class="email-box">${esc(corpo)}</pre>
    <div class="form-acoes" style="flex-wrap:wrap">
      <button class="btn btn-ghost" id="re-copy">📋 Copiar texto</button>
      ${c.email?`<a class="btn btn-sec" href="${gmail}" target="_blank" rel="noopener">✉ Abrir no Gmail</a>`:''}
      ${waUrl?`<a class="btn btn-wa" href="${waUrl}" target="_blank" rel="noopener">${WA_ICON} WhatsApp</a>`:''}
      <button class="btn btn-primary" id="re-enviado">✓ Marcar enviado</button>
    </div>`);
  $('#re-copy').onclick=()=>{ try{ navigator.clipboard.writeText(corpo); toast('Texto copiado!'); }catch(e){ toast('Copie manualmente.',true); } };
  $('#re-enviado').onclick=async()=>{ await sb.from('renovacoes').update({status_contato:'Enviado'}).eq('id',id); fecharModal(); await carregarTudo(true); toast('Marcado como enviado.'); };
  if(focoWa && waUrl) setTimeout(()=>{ try{ window.open(waUrl,'_blank'); }catch(e){} }, 50);
}

/* ---------- start ---------- */
iniciar();
