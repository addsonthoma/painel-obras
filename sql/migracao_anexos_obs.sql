-- =====================================================================
--  MIGRAÇÃO — Observações na obra + Anexos de arquivos
--  Rode no Supabase > SQL Editor (uma vez). Idempotente.
-- =====================================================================

-- 1) Campo de observações livres na obra
alter table public.obras add column if not exists observacoes text;

-- 2) Anexos (vários arquivos por obra, qualquer tipo)
create table if not exists public.obra_anexos (
  id              uuid primary key default gen_random_uuid(),
  obra_id         uuid not null references public.obras(id) on delete cascade,
  nome            text not null,
  path            text not null,          -- caminho no Storage (bucket 'projetos')
  mime            text,
  tamanho         bigint,
  criado_por_nome text,
  criado_em       timestamptz not null default now()
);
create index if not exists idx_obra_anexos_obra on public.obra_anexos(obra_id);

alter table public.obra_anexos enable row level security;
drop policy if exists anexos_sel on public.obra_anexos;
create policy anexos_sel on public.obra_anexos for select to authenticated using (true);
drop policy if exists anexos_adm on public.obra_anexos;
create policy anexos_adm on public.obra_anexos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
--  (DEPOIS de criar os usuários em Authentication > Add user)
--  Torna TODOS os usuários atuais admin. Rode ANTES de criar logins de campo.
-- =====================================================================
-- update public.perfis set papel = 'admin';
