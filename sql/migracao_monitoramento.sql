-- =====================================================================
--  MÓDULO MONITORAMENTO — edificações de clientes no e-SCI (CBMSC)
--  Rode no Supabase > SQL Editor (numa janela LIMPA / New query). Idempotente.
-- =====================================================================

-- Clientes que monitoramos
create table if not exists public.monitor_clientes (
  id                     uuid primary key default gen_random_uuid(),
  nome                   text not null,
  telefone               text,
  contabilidade_nome     text,
  contabilidade_telefone text,
  ativo                  boolean not null default true,
  criado_em              timestamptz not null default now()
);

-- RE's (edificações) de cada cliente
create table if not exists public.monitor_res (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references public.monitor_clientes(id) on delete cascade,
  re_codigo          text not null,
  nome_edificacao    text,
  cidade             text,
  endereco           text,
  numg_edificacao    bigint,            -- id interno do e-SCI (usado pelo coletor logado)
  funcionamento_data date,              -- emissão do último funcionamento (validade = +1 ano)
  ultima_manutencao  date,              -- última manutenção feita (próxima = +5 meses)
  ultima_verificacao timestamptz,       -- última checagem do coletor no e-SCI
  ativo              boolean not null default true,
  obs                text,
  criado_em          timestamptz not null default now()
);
create index if not exists idx_monitor_res_cliente on public.monitor_res(cliente_id);

-- Autos encontrados por RE (AF = fiscalização, MUL = multa)
create table if not exists public.monitor_autos (
  id         uuid primary key default gen_random_uuid(),
  re_id      uuid not null references public.monitor_res(id) on delete cascade,
  tipo       text not null,            -- 'AF' | 'MUL'
  codigo     text not null,
  data       text,
  situacao   text,
  exigencia  text,
  prazo      text,
  resolvido  boolean not null default false,
  novo       boolean not null default true,   -- alerta até alguém ver
  criado_em  timestamptz not null default now(),
  unique (re_id, codigo)
);
create index if not exists idx_monitor_autos_re on public.monitor_autos(re_id);

-- ===== RLS: todo logado lê; só admin altera =====
alter table public.monitor_clientes enable row level security;
alter table public.monitor_res      enable row level security;
alter table public.monitor_autos    enable row level security;

drop policy if exists mon_cli_sel on public.monitor_clientes;
create policy mon_cli_sel on public.monitor_clientes for select to authenticated using (true);
drop policy if exists mon_cli_adm on public.monitor_clientes;
create policy mon_cli_adm on public.monitor_clientes for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists mon_res_sel on public.monitor_res;
create policy mon_res_sel on public.monitor_res for select to authenticated using (true);
drop policy if exists mon_res_adm on public.monitor_res;
create policy mon_res_adm on public.monitor_res for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists mon_aut_sel on public.monitor_autos;
create policy mon_aut_sel on public.monitor_autos for select to authenticated using (true);
drop policy if exists mon_aut_adm on public.monitor_autos;
create policy mon_aut_adm on public.monitor_autos for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ===== SEED: ADM NELSON + as 4 RE's (dados puxados do e-SCI) =====
insert into public.monitor_clientes (nome)
select 'ADM NELSON'
where not exists (select 1 from public.monitor_clientes where nome = 'ADM NELSON');

insert into public.monitor_res (cliente_id, re_codigo, nome_edificacao, cidade, endereco, numg_edificacao)
select c.id, v.re, v.nome, v.cidade, v.endereco, v.numg
from public.monitor_clientes c
cross join (values
  ('RE8161000910A','CENTRO LOGÍSTICO CIDADE NOVA','ITAJAÍ','Rodovia BR-101, 9395', 26090),
  ('RE8055001147A','ADMINISTRADORA NELSON LTDA','BRUSQUE','Rua Blumenau, 91', 110122),
  ('RE8161001291A','Administradora Nelson','ITAJAÍ','Rodovia Jorge Lacerda, 350', 36035),
  ('RE8221001079A','ADMINISTRADORA NELSON LTDA','NAVEGANTES','Rua Prefeito Manoel Evaldo Muller, 1338', 132051)
) as v(re,nome,cidade,endereco,numg)
where c.nome = 'ADM NELSON'
  and not exists (select 1 from public.monitor_res r where r.re_codigo = v.re);
