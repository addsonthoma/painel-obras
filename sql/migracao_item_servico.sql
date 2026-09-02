-- =====================================================================
--  MATERIAL SABE A QUE SERVIÇO PERTENCE
--  Rode no Supabase > SQL Editor (janela LIMPA / New query). Idempotente.
--
--  Ao importar SHP + SDAI + SPDA de uma vez, os materiais viravam uma lista
--  só: para tirar o SPDA era preciso apagar item por item, e a folha do
--  estoque saía sempre com tudo. Com esta coluna cada material guarda o
--  serviço de onde veio, então dá para remover/imprimir por serviço.
-- =====================================================================

alter table public.obra_itens      add column if not exists servico text;
alter table public.orcamento_itens add column if not exists servico text;

create index if not exists idx_obra_itens_servico on public.obra_itens(servico);

-- =====================================================================
--  FIM. Recarregue o portal (F5).
--  Obs.: os materiais que JÁ existem ficam sem serviço e aparecem no grupo
--  "Sem serviço" — dá para movê-los ou removê-los normalmente.
-- =====================================================================
