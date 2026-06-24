-- =====================================================================
--  MÓDULO RENOVAÇÕES (PÓS-VENDA) — máquina de renovações do Henrique
--  Rode no Supabase > SQL Editor (janela LIMPA / New query). Idempotente.
--
--  Clientes com obrigações que renovam (SHP anual, SDAI, extintores, SPDA,
--  gás...). Cada linha = um cliente com o vencimento mais próximo + sistemas.
--  Só ADMIN enxerga (Henrique/Aline).
-- =====================================================================

create table if not exists public.renovacoes (
  id              uuid primary key default gen_random_uuid(),
  contratante     text not null,
  cnpj_cpf        text,
  cidade          text,
  endereco        text,                      -- endereço da obra
  email           text,
  telefone        text,
  vencimento      date,                       -- próximo vencimento (o mais cedo entre os sistemas)
  sistemas        text[] not null default '{}',  -- ex.: {Hidrantes (SHP),SPDA,Extintores}
  status_contato  text not null default 'Não contatado'
                  check (status_contato in ('Não contatado','Rascunho criado','Enviado','Em negociação','Contratado','Inativo')),
  observacoes     text default '',
  baixada         boolean not null default false,   -- empresa baixada/inativa na Receita
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

drop trigger if exists renov_touch on public.renovacoes;
create trigger renov_touch before update on public.renovacoes
  for each row execute function public.touch_atualizado_em();

create index if not exists idx_renovacoes_venc on public.renovacoes(vencimento);

-- ===== RLS: SÓ ADMIN (Henrique/Aline) =====
alter table public.renovacoes enable row level security;
drop policy if exists renov_adm on public.renovacoes;
create policy renov_adm on public.renovacoes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
--  FIM. Depois rode o migrador (privado/migrar_posvenda.py) p/ trazer a base
--  do posVenda.db, e recarregue o portal — a aba ♻️ Renovações aparece p/ admin.
-- =====================================================================
