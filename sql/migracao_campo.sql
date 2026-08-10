-- =====================================================================
--  MÓDULO CAMPO — apontamento de obra pelo celular da equipe
--  Rode no Supabase > SQL Editor (janela LIMPA / New query). Idempotente.
--
--  NÃO RODE AINDA se o beta ainda não foi aprovado. A página /campo/ roda
--  em modo demonstração (localStorage) enquanto CAMPO_DEMO = true.
--
--  1) obra_apontamentos: um registro por equipe/obra/dia. Substitui a folha
--     de papel. Obra pode vir vazia — o escritório resolve depois.
--  2) obra_coordenadas: ponto de cada obra, aprendido sozinho a cada visita.
--  3) vw_campo_agora: quem está onde agora (quadro do escritório).
--
--  PRIVACIDADE: coordenada é gravada só nos dois toques (chegada e saída).
--  Não existe rastreamento contínuo e não há coluna para isso — de propósito.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Apontamentos
-- ---------------------------------------------------------------------
create table if not exists public.obra_apontamentos (
  id                 uuid primary key default gen_random_uuid(),

  obra_id            uuid references public.obras(id) on delete set null,
  obra_texto         text,                    -- nome falado/digitado quando não há obra_id
  origem_obra        text not null default 'nao_informada'
                     check (origem_obra in ('agenda','gps','recente','digitada','nao_informada')),

  data               date not null default current_date,
  saiu_patio_em      timestamptz,             -- toque "vou para" no pátio
  chegou_em          timestamptz,             -- toque "cheguei"
  terminou_em        timestamptz,             -- toque "terminei"

  equipe             text[] not null default '{}',
  veiculo            text,
  servicos           text[] not null default '{}',
  observacoes        text,

  lat_chegada        numeric(9,6),
  lon_chegada        numeric(9,6),
  precisao_chegada   int,                     -- metros informados pelo GPS
  lat_saida          numeric(9,6),
  lon_saida          numeric(9,6),

  apontado_por       uuid references public.perfis(id) on delete set null,
  apontado_por_nome  text not null,

  resolvido          boolean not null default false,   -- fila do escritório
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

create index if not exists idx_apont_data on public.obra_apontamentos(data desc);
create index if not exists idx_apont_obra on public.obra_apontamentos(obra_id);
create index if not exists idx_apont_aberto on public.obra_apontamentos(chegou_em)
  where terminou_em is null;
create index if not exists idx_apont_pendente on public.obra_apontamentos(resolvido)
  where obra_id is null;

drop trigger if exists apont_touch on public.obra_apontamentos;
create trigger apont_touch before update on public.obra_apontamentos
  for each row execute function public.touch_atualizado_em();

-- RLS: todo logado lê (o escritório e a própria equipe precisam ver).
-- Insere/edita: o autor do apontamento, ou admin.
alter table public.obra_apontamentos enable row level security;

drop policy if exists apont_sel on public.obra_apontamentos;
create policy apont_sel on public.obra_apontamentos for select to authenticated
  using (true);

drop policy if exists apont_ins on public.obra_apontamentos;
create policy apont_ins on public.obra_apontamentos for insert to authenticated
  with check (apontado_por = auth.uid() or public.is_admin());

drop policy if exists apont_upd on public.obra_apontamentos;
create policy apont_upd on public.obra_apontamentos for update to authenticated
  using (apontado_por = auth.uid() or public.is_admin())
  with check (apontado_por = auth.uid() or public.is_admin());

drop policy if exists apont_del on public.obra_apontamentos;
create policy apont_del on public.obra_apontamentos for delete to authenticated
  using (public.is_admin());


-- ---------------------------------------------------------------------
-- 2) Coordenada de cada obra — aprendida sozinha
--    Toda vez que alguém escolhe a obra na mão, guardamos o ponto.
--    A média móvel vai corrigindo o erro do GPS a cada visita.
-- ---------------------------------------------------------------------
create table if not exists public.obra_coordenadas (
  obra_id       uuid primary key references public.obras(id) on delete cascade,
  lat           numeric(9,6) not null,
  lon           numeric(9,6) not null,
  amostras      int not null default 1,
  atualizado_em timestamptz not null default now()
);

alter table public.obra_coordenadas enable row level security;

drop policy if exists coord_sel on public.obra_coordenadas;
create policy coord_sel on public.obra_coordenadas for select to authenticated
  using (true);

drop policy if exists coord_ins on public.obra_coordenadas;
create policy coord_ins on public.obra_coordenadas for insert to authenticated
  with check (true);

drop policy if exists coord_upd on public.obra_coordenadas;
create policy coord_upd on public.obra_coordenadas for update to authenticated
  using (true) with check (true);

-- Média móvel: cada nova visita puxa o ponto um pouco para o valor médio.
create or replace function public.registrar_coordenada_obra(
  p_obra_id uuid, p_lat numeric, p_lon numeric
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.obra_coordenadas (obra_id, lat, lon, amostras)
    values (p_obra_id, p_lat, p_lon, 1)
  on conflict (obra_id) do update set
    lat           = (public.obra_coordenadas.lat * public.obra_coordenadas.amostras + p_lat)
                    / (public.obra_coordenadas.amostras + 1),
    lon           = (public.obra_coordenadas.lon * public.obra_coordenadas.amostras + p_lon)
                    / (public.obra_coordenadas.amostras + 1),
    amostras      = least(public.obra_coordenadas.amostras + 1, 20),
    atualizado_em = now();
end $$;


-- ---------------------------------------------------------------------
-- 3) Quadro do escritório: quem está onde agora
-- ---------------------------------------------------------------------
create or replace view public.vw_campo_agora as
select
  a.id,
  a.obra_id,
  coalesce(o.cliente, a.obra_texto, 'obra não informada') as obra,
  o.endereco,
  a.equipe,
  a.veiculo,
  a.saiu_patio_em,
  a.chegou_em,
  case
    when a.chegou_em is not null then 'em_obra'
    when a.saiu_patio_em is not null then 'a_caminho'
    else 'indefinido'
  end as situacao,
  now() - coalesce(a.chegou_em, a.saiu_patio_em) as tempo,
  a.apontado_por_nome
from public.obra_apontamentos a
left join public.obras o on o.id = a.obra_id
where a.terminou_em is null
  and a.data >= current_date - 1
order by coalesce(a.chegou_em, a.saiu_patio_em);

-- =====================================================================
--  FIM. Depois disso, troque CAMPO_DEMO para false em docs/campo/campo.js.
-- =====================================================================
