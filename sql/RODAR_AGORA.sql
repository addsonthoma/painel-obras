-- =====================================================================
--  RODAR NO SUPABASE > SQL Editor (New query) > RUN
--  Conferido em 03/09/2026: e SO isto que falta no seu banco.
--  Pode rodar de novo sem medo (nao duplica nada).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) MATERIAL DO ORCAMENTO SABE A QUE SERVICO PERTENCE
--    (a coluna das OBRAS voce ja rodou; faltou a dos ORCAMENTOS)
--    E o que permite remover/imprimir por servico (SHP, SDAI, SPDA...).
-- ---------------------------------------------------------------------
alter table public.orcamento_itens add column if not exists servico text;
create index if not exists idx_obra_itens_servico on public.obra_itens(servico);


-- ---------------------------------------------------------------------
-- 2) META SEMANAL DE COBRANCAS (para poder ajustar os R$ 100 mil)
--    Sem isso o painel funciona com 100 mil fixo, mas o botao
--    "Ajustar meta" da erro ao salvar.
-- ---------------------------------------------------------------------
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
insert into public.painel_config (chave, valor) values ('meta_cobranca_semanal', 100000)
on conflict (chave) do nothing;

-- =====================================================================
--  FIM. Depois e so dar F5 no portal.
-- =====================================================================
