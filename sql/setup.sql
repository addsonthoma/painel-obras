-- =====================================================================
--  PAINEL DE OBRAS — Rodrigues Preventivos
--  Banco de dados (Supabase / PostgreSQL)
--
--  COMO USAR:
--  1. No painel do Supabase, abra  SQL Editor  ->  New query
--  2. Cole este arquivo INTEIRO e clique RUN.
--  3. Rode só uma vez. Pode rodar de novo sem quebrar (idempotente): o seed
--     da equipe SÓ entra se a tabela estiver vazia (não apaga edições).
--  4. Depois rode as migrações de sql/ na ordem (ver SETUP.md).
--
--  Segurança em uma frase:
--  - Tudo que é DINHEIRO mora na tabela  obra_financeiro  e só ADMIN lê.
--  - Operação (funcionários) enxerga obras, prazos e materiais — nunca valores.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) PERFIS  (estende os usuários de login com um "papel")
--    papel: 'admin'    -> Addson, Henrique, Rodrigues, Aline (veem tudo)
--           'operacao' -> demais logins (veem obras/prazos/materiais, SEM dinheiro)
-- ---------------------------------------------------------------------
create table if not exists public.perfis (
  id        uuid primary key references auth.users(id) on delete cascade,
  nome      text,
  papel     text not null default 'operacao' check (papel in ('admin','operacao')),
  criado_em timestamptz not null default now()
);
-- "vendedor" identifica o comercial (Aline/Banana/Guilherme/Addson/Henrique)
alter table public.perfis add column if not exists vendedor text;

-- Cria o perfil automaticamente quando um usuário novo é criado no Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome, papel)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', new.email), 'operacao')
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper usado nas regras de segurança: o usuário logado é admin?
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and papel = 'admin'
  );
$$;

-- Helper: é do COMERCIAL? (admin, ou perfil com "vendedor" preenchido)
create or replace function public.is_comercial()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and (papel = 'admin' or vendedor is not null)
  );
$$;

-- Helper: pode ver o módulo OBRAS? (admin, ou operação SEM vendedor —
-- vendedor "puro" usa Orçamentos/Leads e não lê as tabelas de obras)
create or replace function public.pode_ver_obras()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and (papel = 'admin' or vendedor is null)
  );
$$;


-- ---------------------------------------------------------------------
-- 2) EQUIPE  (funcionários de campo, usados para SUGERIR o time)
--    Separado dos logins de propósito: nem todo funcionário precisa logar.
--    principais  = especialidades (preferência na sugestão)
--    habilidades = tudo que a pessoa consegue fazer (inclui "ajuda em")
--    Valores possíveis: SHP, SPDA, SDAI, VITAIS, GAS, SKID, AJUDANTE,
--                       PAINEL_ELETRICO, STARTUP_BOMBA
-- ---------------------------------------------------------------------
create table if not exists public.equipe (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  funcao      text,
  principais  text[] not null default '{}',
  habilidades text[] not null default '{}',
  coringa     boolean not null default false,   -- Douglas (reforço, acerto por fora)
  parceiro    boolean not null default false,   -- Wagner (painel elétrico / start-up)
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 3) OBRAS  (sem nenhum campo de dinheiro — dinheiro fica na tabela 4)
--    status_execucao: em_andamento | pendente_material | pendente_execucao | concluida
-- ---------------------------------------------------------------------
create table if not exists public.obras (
  id                uuid primary key default gen_random_uuid(),
  cliente           text not null,
  endereco          text,
  telefone_cliente  text,
  orcamento_qs      text,                              -- ex.: OR901
  data_inicio       date,
  data_prazo        date,                              -- usado para ordenar por urgência
  tem_skid          boolean not null default false,
  equipe_sugerida   text[] not null default '{}',      -- nomes sugeridos pelo motor
  equipe_confirmada text[] not null default '{}',      -- nomes que o admin confirmou
  status_execucao   text not null default 'em_andamento'
                    check (status_execucao in ('em_andamento','pendente_material','pendente_execucao','concluida')),
  pendencia_obs     text,                              -- o que falta (material/execução)
  concluida_por     uuid references public.perfis(id),
  concluida_por_nome text,
  concluida_em      timestamptz,
  projeto_pdf_path  text,                              -- caminho do PDF no Storage
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

create or replace function public.touch_atualizado_em()
returns trigger language plpgsql as $$
begin new.atualizado_em = now(); return new; end; $$;

drop trigger if exists obras_touch on public.obras;
create trigger obras_touch before update on public.obras
  for each row execute function public.touch_atualizado_em();


-- ---------------------------------------------------------------------
-- 4) OBRA_FINANCEIRO  (TUDO que é dinheiro/cobrança — SÓ ADMIN enxerga)
--    1 linha por obra. status_cobranca: nao_aplicavel | a_cobrar | cobranca_enviada | pago
-- ---------------------------------------------------------------------
create table if not exists public.obra_financeiro (
  obra_id             uuid primary key references public.obras(id) on delete cascade,
  valor_total         numeric(12,2),
  status_cobranca     text not null default 'nao_aplicavel'
                      check (status_cobranca in ('nao_aplicavel','a_cobrar','cobranca_enviada','pago')),
  valor_cobrado       numeric(12,2),   -- RESERVADO: ainda sem tela p/ editar (app usa valor_total)
  cobranca_enviada_em timestamptz,
  pago_em             timestamptz,
  cobranca_obs        text,            -- RESERVADO: ainda sem tela p/ editar
  atualizado_em       timestamptz not null default now()
);

drop trigger if exists fin_touch on public.obra_financeiro;
create trigger fin_touch before update on public.obra_financeiro
  for each row execute function public.touch_atualizado_em();


-- ---------------------------------------------------------------------
-- 5) OBRA_SERVICOS  (dias x pessoas por serviço — ex.: SHP 3 dias / 3 pessoas)
--    servico: SHP, SPDA, VITAIS, SDAI, GLP, AR_COMPRIMIDO,
--             MANUT_SHP, MANUT_SKID, MANUT_ALARME
-- ---------------------------------------------------------------------
create table if not exists public.obra_servicos (
  id      uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras(id) on delete cascade,
  servico text not null,
  dias    int,
  pessoas int
);
create index if not exists idx_obra_servicos_obra on public.obra_servicos(obra_id);


-- ---------------------------------------------------------------------
-- 6) OBRA_ITENS  (materiais — SEM valor de propósito; é a folha do Moritz)
-- ---------------------------------------------------------------------
create table if not exists public.obra_itens (
  id         uuid primary key default gen_random_uuid(),
  obra_id    uuid not null references public.obras(id) on delete cascade,
  produto    text not null,
  quantidade numeric(12,3) not null default 1,
  unidade    text,
  servico    text,           -- RESERVADO: nenhum fluxo preenche hoje (agrupamento futuro)
  ordem      int default 0
);
create index if not exists idx_obra_itens_obra on public.obra_itens(obra_id);


-- ---------------------------------------------------------------------
-- 7) OBRA_LOG  (quem mudou o quê — confirma "concluído por fulano")
-- ---------------------------------------------------------------------
create table if not exists public.obra_log (
  id           uuid primary key default gen_random_uuid(),
  obra_id      uuid not null references public.obras(id) on delete cascade,
  usuario_id   uuid references public.perfis(id),
  usuario_nome text,
  acao         text not null,
  detalhe      text,
  criado_em    timestamptz not null default now()
);
create index if not exists idx_obra_log_obra on public.obra_log(obra_id);


-- =====================================================================
--  SEGURANÇA (Row Level Security)
-- =====================================================================
alter table public.perfis           enable row level security;
alter table public.equipe           enable row level security;
alter table public.obras            enable row level security;
alter table public.obra_financeiro  enable row level security;
alter table public.obra_servicos    enable row level security;
alter table public.obra_itens       enable row level security;
alter table public.obra_log         enable row level security;

-- PERFIS: todo logado lê (para mostrar nomes); só admin altera papéis.
drop policy if exists perfis_sel on public.perfis;
create policy perfis_sel on public.perfis for select to authenticated using (true);
drop policy if exists perfis_adm on public.perfis;
create policy perfis_adm on public.perfis for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- EQUIPE: todo logado lê; só admin altera.
drop policy if exists equipe_sel on public.equipe;
create policy equipe_sel on public.equipe for select to authenticated using (true);
drop policy if exists equipe_adm on public.equipe;
create policy equipe_adm on public.equipe for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- OBRAS: lê quem pode ver o módulo Obras (admin + operação sem vendedor); só admin altera.
drop policy if exists obras_sel on public.obras;
create policy obras_sel on public.obras for select to authenticated using (public.pode_ver_obras());
drop policy if exists obras_adm on public.obras;
create policy obras_adm on public.obras for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- OBRA_FINANCEIRO: SÓ ADMIN — nem leitura para operação.
drop policy if exists fin_adm on public.obra_financeiro;
create policy fin_adm on public.obra_financeiro for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- SERVIÇOS / ITENS / LOG: lê quem pode ver Obras; só admin altera.
drop policy if exists serv_sel on public.obra_servicos;
create policy serv_sel on public.obra_servicos for select to authenticated using (public.pode_ver_obras());
drop policy if exists serv_adm on public.obra_servicos;
create policy serv_adm on public.obra_servicos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists itens_sel on public.obra_itens;
create policy itens_sel on public.obra_itens for select to authenticated using (public.pode_ver_obras());
drop policy if exists itens_adm on public.obra_itens;
create policy itens_adm on public.obra_itens for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists log_sel on public.obra_log;
create policy log_sel on public.obra_log for select to authenticated using (public.pode_ver_obras());
drop policy if exists log_ins on public.obra_log;
create policy log_ins on public.obra_log for insert to authenticated with check (public.is_admin());


-- =====================================================================
--  STORAGE  (bucket privado para os projetos preventivos em PDF)
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('projetos', 'projetos', false)
on conflict (id) do nothing;

-- Leitura por PREFIXO (mesma regra da migracao_privacidade.sql):
--   orcamentos/% -> comercial · restrito/% -> só admin · demais -> quem vê obras
drop policy if exists projetos_sel on storage.objects;
create policy projetos_sel on storage.objects for select to authenticated
  using (bucket_id = 'projetos' and (
    public.is_admin()
    or (public.is_comercial() and name like 'orcamentos/%')
    or (public.pode_ver_obras() and name not like 'orcamentos/%' and name not like 'restrito/%')
  ));
-- Escrita: admin tudo; comercial só sob orcamentos/ (igual à migracao_orcamentos.sql)
drop policy if exists projetos_ins on storage.objects;
create policy projetos_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'projetos'
    and (public.is_admin() or (public.is_comercial() and name like 'orcamentos/%')));
drop policy if exists projetos_upd on storage.objects;
create policy projetos_upd on storage.objects for update to authenticated
  using (bucket_id = 'projetos'
    and (public.is_admin() or (public.is_comercial() and name like 'orcamentos/%')));
drop policy if exists projetos_del on storage.objects;
create policy projetos_del on storage.objects for delete to authenticated
  using (bucket_id = 'projetos'
    and (public.is_admin() or (public.is_comercial() and name like 'orcamentos/%')));


-- =====================================================================
--  SEED — EQUIPE (os 7 da frente + Douglas coringa + Wagner parceiro)
--  SÓ entra se a tabela estiver VAZIA — rodar de novo NUNCA apaga/reverte
--  as edições feitas na aba Equipe do painel.
-- =====================================================================
insert into public.equipe (nome, funcao, principais, habilidades, coringa, parceiro, ativo)
select * from (values
  ('Valdir',   'Instalador',            '{SHP,SPDA}'::text[],        '{SHP,SPDA,VITAIS,SDAI}'::text[],          false, false, true),
  ('Paulinho', 'Instalador',            '{SHP,SPDA}'::text[],        '{SHP,SPDA,VITAIS,SDAI}'::text[],          false, false, true),
  ('Junior',   'Instalador (faz tudo)', '{SHP,SPDA,SDAI}'::text[],   '{SHP,SPDA,SDAI,VITAIS}'::text[],          false, false, true),
  ('Adeilson', 'Instalador / Skid',     '{GAS,SPDA,SHP,SKID}'::text[],'{GAS,SPDA,SHP,VITAIS,SKID}'::text[],     false, false, true),
  ('Pedro',    'Instalador / Skid',     '{GAS,SPDA,SHP,SKID}'::text[],'{GAS,SPDA,SHP,VITAIS,SKID}'::text[],     false, false, true),
  ('Beto',     'Alarme / Vitais',       '{SDAI,VITAIS}'::text[],     '{SDAI,VITAIS}'::text[],                   false, false, true),
  ('Gledson',  'Ajudante',              '{AJUDANTE}'::text[],        '{AJUDANTE}'::text[],                      false, false, true),
  ('Douglas',  'Coringa (alarme/vitais, por fora)', '{SDAI,VITAIS}'::text[], '{SDAI,VITAIS}'::text[],          true,  false, true),
  ('Wagner',   'Parceiro — painel elétrico / start-up de bombas', '{PAINEL_ELETRICO,STARTUP_BOMBA}'::text[], '{PAINEL_ELETRICO,STARTUP_BOMBA}'::text[], false, true, true)
) as v(nome, funcao, principais, habilidades, coringa, parceiro, ativo)
where not exists (select 1 from public.equipe);

-- =====================================================================
--  FIM. Próximo passo: criar os usuários de login (ver SETUP.md, passo 4)
--  e depois promover os 4 administradores com:
--
--    update public.perfis set papel = 'admin'
--    where id in (select id from auth.users
--                 where email in ('email_addson','email_henrique','email_rodrigues','email_aline'));
-- =====================================================================
