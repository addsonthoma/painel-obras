-- =====================================================================
--  METAS DO PAINEL — meta semanal de cobranças (ajustável)
--  Rode no Supabase > SQL Editor (janela LIMPA / New query). Idempotente.
--
--  Guarda configurações simples do painel (chave -> valor). Hoje só a meta
--  semanal de cobranças; serve para outras metas no futuro.
--  SÓ ADMIN (é informação financeira, mesmo critério de obra_financeiro).
-- =====================================================================

create table if not exists public.painel_config (
  chave         text primary key,
  valor         numeric,
  texto         text,
  atualizado_em timestamptz not null default now()
);

drop trigger if exists cfg_touch on public.painel_config;
create trigger cfg_touch before update on public.painel_config
  for each row execute function public.touch_atualizado_em();

alter table public.painel_config enable row level security;
drop policy if exists cfg_adm on public.painel_config;
create policy cfg_adm on public.painel_config for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- meta padrão: R$ 100.000 por semana (segunda a domingo)
insert into public.painel_config (chave, valor)
values ('meta_cobranca_semanal', 100000)
on conflict (chave) do nothing;

-- =====================================================================
--  FIM. O painel funciona mesmo sem esta tabela (assume R$ 100 mil),
--  mas só dá para AJUSTAR a meta depois de rodar isto.
-- =====================================================================
