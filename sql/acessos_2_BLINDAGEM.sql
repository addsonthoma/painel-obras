-- =====================================================================
--  PAINEL DE ACESSOS — BLINDAGEM (opcional, rodar DEPOIS do arquivo 1)
--
--  Para que serve: sem isto, quem é desconectado e está com o Portal
--  aberto cai em até 30 s (o Portal confere sozinho). Mas quem tivesse
--  copiado o "token" de acesso por fora ainda conseguiria ler dados por
--  até 1 hora, até o token vencer.
--  Com a blindagem, o BANCO recusa na hora qualquer leitura de uma
--  sessão que foi derrubada — vale para todas as tabelas.
--
--  Quando rodar: depois que a aba "🔐 Acessos" mostrar
--  "✓ Sua sessão é reconhecida — seguro ativar a blindagem".
--  NÃO desconecta ninguém: sessão válida continua funcionando igual.
-- =====================================================================

do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists sessao_ativa_obrigatoria on public.%I', t.relname);
    -- RESTRICTIVE = soma às regras que já existem (não substitui nenhuma).
    -- coalesce(..., true): token sem id de sessão não é bloqueado (evita trancar todo mundo fora).
    execute format(
      'create policy sessao_ativa_obrigatoria on public.%I as restrictive
         for all to authenticated
         using (coalesce((select public.sessao_ativa()), true))
         with check (coalesce((select public.sessao_ativa()), true))', t.relname);
  end loop;
end $$;

-- conferência: quantas tabelas ficaram blindadas
select count(*) as tabelas_blindadas
  from pg_policies
 where schemaname = 'public' and policyname = 'sessao_ativa_obrigatoria';


-- =====================================================================
--  PARA DESFAZER (se algum dia precisar):
--
--  do $$ declare t record; begin
--    for t in select tablename from pg_policies
--              where schemaname='public' and policyname='sessao_ativa_obrigatoria'
--    loop execute format('drop policy sessao_ativa_obrigatoria on public.%I', t.tablename);
--    end loop; end $$;
-- =====================================================================
