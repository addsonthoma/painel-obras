-- =====================================================================
--  MIGRAÇÃO — PRIVACIDADE (anexos restritos + leitura por papel)
--  Rode no Supabase > SQL Editor (janela LIMPA / New query). Idempotente.
--
--  O que corrige:
--  1) PDF do Quanto Sobra anexado à obra tem PREÇOS — a operação (campo)
--     conseguia abrir. Agora: anexos "restritos" só admin vê (flag na
--     tabela + prefixo restrito/ no Storage).
--  2) A leitura do bucket 'projetos' era liberada para QUALQUER logado
--     (dava até para listar as propostas em orcamentos/). Agora respeita
--     prefixos: orcamentos/ = comercial · restrito/ = admin · resto = obras.
--  3) Vendedor "puro" (Banana/Guilherme) não lê mais as tabelas de obras
--     pela API (a tela já escondia; agora o banco também bloqueia).
-- =====================================================================

-- Helper: quem pode ver o módulo OBRAS? (admin, ou operação SEM vendedor)
create or replace function public.pode_ver_obras()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and (papel = 'admin' or vendedor is null)
  );
$$;

-- 1) Anexos restritos (contêm valores — ex.: PDF do Quanto Sobra)
alter table public.obra_anexos add column if not exists restrito boolean not null default false;

-- marca como restrito o que já foi movido para o prefixo restrito/ do Storage
update public.obra_anexos set restrito = true where path like 'restrito/%' and restrito = false;

drop policy if exists anexos_sel on public.obra_anexos;
create policy anexos_sel on public.obra_anexos for select to authenticated
  using (public.pode_ver_obras() and (not restrito or public.is_admin()));

-- 2) Tabelas de obras: leitura só para quem pode ver o módulo Obras
drop policy if exists obras_sel on public.obras;
create policy obras_sel on public.obras for select to authenticated using (public.pode_ver_obras());
drop policy if exists serv_sel on public.obra_servicos;
create policy serv_sel on public.obra_servicos for select to authenticated using (public.pode_ver_obras());
drop policy if exists itens_sel on public.obra_itens;
create policy itens_sel on public.obra_itens for select to authenticated using (public.pode_ver_obras());
drop policy if exists log_sel on public.obra_log;
create policy log_sel on public.obra_log for select to authenticated using (public.pode_ver_obras());

-- 3) Storage: leitura do bucket 'projetos' por PREFIXO
--    orcamentos/%  -> comercial (admin ou vendedor)   [propostas com valores]
--    restrito/%    -> só admin                        [PDFs do QS nas obras]
--    demais        -> quem pode ver obras             [projetos e anexos comuns]
drop policy if exists projetos_sel on storage.objects;
create policy projetos_sel on storage.objects for select to authenticated
  using (bucket_id = 'projetos' and (
    public.is_admin()
    or (public.is_comercial() and name like 'orcamentos/%')
    or (public.pode_ver_obras() and name not like 'orcamentos/%' and name not like 'restrito/%')
  ));

-- =====================================================================
--  FIM. Depois de rodar, recarregue o portal (Ctrl+F5).
--  Requer que sql/migracao_orcamentos.sql já tenha rodado (is_comercial) — já rodou.
-- =====================================================================
