-- =====================================================================
--  MÓDULO ORÇAMENTOS — follow-up de propostas comerciais
--  Rode no Supabase > SQL Editor (numa janela LIMPA / New query). Idempotente.
--
--  Quem usa: o COMERCIAL (admin OU quem tem "vendedor" no perfil).
--  Funil: Em aberto (a orçar / enviado) -> Ganho (vira obra) | Perdido (com motivo).
--  Rolling de 7 dias: proximo_followup = (ultimo_contato | enviado_em) + intervalo_dias.
-- =====================================================================

-- 0) Garante a coluna usada para identificar o comercial (já existe na base viva,
--    mas deixamos resiliente para não quebrar a função abaixo).
alter table public.perfis add column if not exists vendedor text;

-- Helper de segurança: o usuário logado é do COMERCIAL?
--  (admin sempre é; ou qualquer perfil com "vendedor" preenchido — Aline/Banana/Guilherme)
create or replace function public.is_comercial()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and (papel = 'admin' or vendedor is not null)
  );
$$;


-- ---------------------------------------------------------------------
-- 1) ORÇAMENTOS  (cada proposta enviada/por enviar a um cliente)
--    status: orcar     -> ainda precisamos montar/enviar o orçamento
--            enviado    -> feito e enviado ao cliente (inicia o rolling de 7 dias)
--            ganho      -> cliente fechou conosco (pode virar obra)
--            perdido    -> cliente fechou com outro / desistiu (com motivo)
-- ---------------------------------------------------------------------
create table if not exists public.orcamentos (
  id                uuid primary key default gen_random_uuid(),
  cliente           text not null,
  origem            text,                       -- de onde veio o lead (indicação, site, leads CBMSC...)
  contato_nome      text,
  telefone          text,
  orcamento_qs      text,                        -- ex.: OR930 (opcional)
  valor_total       numeric(12,2),
  status            text not null default 'orcar'
                    check (status in ('orcar','enviado','ganho','perdido')),
  enviado_em        timestamptz,                 -- quando marcou como enviado (base do rolling)
  ultimo_contato    timestamptz,                 -- último follow-up registrado (reinicia o rolling)
  proximo_followup  date,                        -- (ultimo_contato|enviado_em) + intervalo_dias
  intervalo_dias    int not null default 7,
  motivo_perda_tipo text,                        -- preco | demora | sem_resposta | concorrencia | desistiu | outro
  motivo_perda      text,
  ganho_em          timestamptz,
  perdido_em        timestamptz,
  obra_id           uuid references public.obras(id) on delete set null,  -- vira obra quando ganho
  responsavel       text,
  observacoes       text,
  projeto_pdf_path  text,                        -- atalho p/ o projeto (no bucket 'projetos')
  criado_por_nome   text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

drop trigger if exists orc_touch on public.orcamentos;
create trigger orc_touch before update on public.orcamentos
  for each row execute function public.touch_atualizado_em();

create index if not exists idx_orcamentos_status on public.orcamentos(status);


-- ---------------------------------------------------------------------
-- 2) ORÇAMENTO_ITENS  (materiais do Quanto Sobra — viram a folha de obra depois)
-- ---------------------------------------------------------------------
create table if not exists public.orcamento_itens (
  id           uuid primary key default gen_random_uuid(),
  orcamento_id uuid not null references public.orcamentos(id) on delete cascade,
  produto      text not null,
  quantidade   numeric(12,3) not null default 1,
  unidade      text,
  ordem        int default 0
);
create index if not exists idx_orc_itens on public.orcamento_itens(orcamento_id);


-- ---------------------------------------------------------------------
-- 3) ORÇAMENTO_CONTATOS  (histórico de follow-up — cada toque reinicia os 7 dias)
--    canal: whatsapp | ligacao | email | presencial | sistema | outro
-- ---------------------------------------------------------------------
create table if not exists public.orcamento_contatos (
  id           uuid primary key default gen_random_uuid(),
  orcamento_id uuid not null references public.orcamentos(id) on delete cascade,
  canal        text,
  observacao   text,
  usuario_nome text,
  criado_em    timestamptz not null default now()
);
create index if not exists idx_orc_contatos on public.orcamento_contatos(orcamento_id);


-- ---------------------------------------------------------------------
-- 4) ORÇAMENTO_ANEXOS  (projeto PDF, arquivo do Quanto Sobra, etc.)
--    tipo: projeto | quanto_sobra | outro   (arquivos no bucket 'projetos', prefixo orcamentos/)
-- ---------------------------------------------------------------------
create table if not exists public.orcamento_anexos (
  id              uuid primary key default gen_random_uuid(),
  orcamento_id    uuid not null references public.orcamentos(id) on delete cascade,
  nome            text not null,
  path            text not null,
  mime            text,
  tamanho         bigint,
  tipo            text,
  criado_por_nome text,
  criado_em       timestamptz not null default now()
);
create index if not exists idx_orc_anexos on public.orcamento_anexos(orcamento_id);


-- =====================================================================
--  SEGURANÇA (RLS) — só o COMERCIAL enxerga e mexe nos orçamentos.
--  (Operação/campo NÃO vê valores comerciais aqui.)
-- =====================================================================
alter table public.orcamentos        enable row level security;
alter table public.orcamento_itens   enable row level security;
alter table public.orcamento_contatos enable row level security;
alter table public.orcamento_anexos  enable row level security;

drop policy if exists orc_all on public.orcamentos;
create policy orc_all on public.orcamentos for all to authenticated
  using (public.is_comercial()) with check (public.is_comercial());

drop policy if exists orc_itens_all on public.orcamento_itens;
create policy orc_itens_all on public.orcamento_itens for all to authenticated
  using (public.is_comercial()) with check (public.is_comercial());

drop policy if exists orc_contatos_all on public.orcamento_contatos;
create policy orc_contatos_all on public.orcamento_contatos for all to authenticated
  using (public.is_comercial()) with check (public.is_comercial());

drop policy if exists orc_anexos_all on public.orcamento_anexos;
create policy orc_anexos_all on public.orcamento_anexos for all to authenticated
  using (public.is_comercial()) with check (public.is_comercial());


-- =====================================================================
--  STORAGE — reaproveita o bucket privado 'projetos'.
--  O comercial pode gerenciar arquivos sob o prefixo 'orcamentos/';
--  admin continua podendo tudo (inclusive os PDFs das obras).
-- =====================================================================
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

-- (a leitura — projetos_sel — já é liberada para todo logado no setup.sql)

-- =====================================================================
--  FIM. Depois de rodar: recarregue o portal (F5) e a aba 💲 Orçamentos aparece
--  para admin e para quem tiver "vendedor" no perfil.
-- =====================================================================
