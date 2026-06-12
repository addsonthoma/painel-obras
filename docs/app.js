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
  user:null, perfil:null, isAdmin:false,
  obras:[], equipe:[], financeiro:{},
  modulo:'obras', aba:'obras', filtroStatus:'ativas', filtroCob:'pendentes', busca:'',
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
  $('#tela-login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-nome').textContent = perfil?.nome || user.email;
  const pb = $('#user-papel'); pb.textContent = state.isAdmin?'admin':'operação';
  pb.classList.toggle('admin', state.isAdmin);
  document.querySelectorAll('.so-admin').forEach(el=>el.classList.toggle('hidden', !state.isAdmin));
  // módulos visíveis por papel (admin vê tudo; operação só Obras)
  const permitidos = state.isAdmin ? ['obras','leads'] : ['obras'];
  document.querySelectorAll('.modulo').forEach(b=> b.classList.toggle('hidden', !permitidos.includes(b.dataset.mod)));
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
  document.getElementById('mod-leads').classList.toggle('hidden', mod!=='leads');
  if(mod==='leads'){ const fr=document.getElementById('leads-frame'); if(!fr.getAttribute('src')) fr.src=LEADS_URL; }
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
function render(){ renderContadores(); renderFiltros(); renderObras(); renderPendencias(); if(state.isAdmin){ renderCobrancas(); renderEquipe(); } }

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

/* ---------- start ---------- */
iniciar();
