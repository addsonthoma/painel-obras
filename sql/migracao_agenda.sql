-- =====================================================================
--  AGENDA DE OBRAS + CHECKLIST DE MATERIAIS
--  Rode no Supabase > SQL Editor (janela LIMPA / New query). Idempotente.
--
--  1) obra_agenda: cada linha = uma obra marcada em UM dia, com a equipe
--     daquele dia. A mesma obra pode ocupar vários dias (ex.: SHP 3 dias).
--  2) obra_itens ganha os checks da folha de separação:
--     separado (o estoque já separou) e faltando (falta comprar -> Pendências).
-- =====================================================================

create table if not exists public.obra_agenda (
  id            uuid primary key default gen_random_uuid(),
  obra_id       uuid not null references public.obras(id) on delete cascade,
  data          date not null,
  equipe        text[] not null default '{}',   -- quem trabalha NESTE dia
  observacoes   text,                            -- recado do dia (ex.: levar andaime)
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (obra_id, data)                         -- a mesma obra não repete no mesmo dia
);
create index if not exists idx_obra_agenda_data on public.obra_agenda(data);
create index if not exists idx_obra_agenda_obra on public.obra_agenda(obra_id);

drop trigger if exists agenda_touch on public.obra_agenda;
create trigger agenda_touch before update on public.obra_agenda
  for each row execute function public.touch_atualizado_em();

-- RLS: TODO LOGADO LÊ (a equipe precisa ver onde trabalha); só admin agenda/edita.
alter table public.obra_agenda enable row level security;
drop policy if exists agenda_sel on public.obra_agenda;
create policy agenda_sel on public.obra_agenda for select to authenticated using (true);
drop policy if exists agenda_adm on public.obra_agenda;
create policy agenda_adm on public.obra_agenda for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------
-- 2) Checks da folha de separação (sem valores — é lista de material puro)
-- ---------------------------------------------------------------------
alter table public.obra_itens add column if not exists separado boolean not null default false;
alter table public.obra_itens add column if not exists faltando boolean not null default false;

-- O ESTOQUE (operação) precisa poder marcar separado/falta.
-- Criar e apagar item continua só para admin; alterar fica liberado para logados.
drop policy if exists itens_upd on public.obra_itens;
create policy itens_upd on public.obra_itens for update to authenticated
  using (true) with check (true);

-- =====================================================================
--  FIM. Depois recarregue o portal (F5): a aba 📅 Agenda aparece em Obras.
-- =====================================================================
