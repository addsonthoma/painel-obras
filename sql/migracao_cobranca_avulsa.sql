-- =====================================================================
--  COBRANÇA AVULSA — cobrar sem precisar criar uma obra
--  Rode no Supabase > SQL Editor (janela LIMPA / New query). Idempotente.
--
--  Ex.: ART, recarga de extintor, visita técnica, serviço rápido.
--  A cobrança avulsa é gravada como uma obra marcada com avulsa=true e já
--  concluída — assim ela entra na aba Cobranças, no medidor da meta semanal e
--  no "marcar pago" sem duplicar nenhuma regra. O painel esconde as avulsas
--  das listas de Obras, Agenda e Pendências (não são serviço de campo).
-- =====================================================================

alter table public.obras add column if not exists avulsa boolean not null default false;

create index if not exists idx_obras_avulsa on public.obras(avulsa);

-- =====================================================================
--  FIM. Recarregue o portal (F5): o botão "+ Nova cobrança" aparece na aba
--  Cobranças (só admin, como o resto do financeiro).
-- =====================================================================
