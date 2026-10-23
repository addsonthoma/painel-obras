-- =====================================================================
--  PAINEL DE ACESSOS — INSTALAÇÃO
--  Supabase > SQL Editor (New query) > RUN.  Pode rodar de novo sem medo.
--
--  ⚠️ ESTE ARQUIVO NÃO DESCONECTA NEM BLOQUEIA NINGUÉM.
--     Ele só cria as funções que a aba "🔐 Acessos" do Portal usa.
--     Desconectar/bloquear só acontece quando um ADMIN clicar no painel.
--
--  Todas as funções conferem is_admin() — quem não é admin recebe
--  "acesso negado", mesmo chamando direto pela API.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) A sessão de quem está chamando ainda existe?
--    true  = sessão válida
--    false = sessão foi derrubada pelo admin (o Portal desloga na hora)
--    null  = token sem identificador de sessão (indeterminado: não mexe)
-- ---------------------------------------------------------------------
create or replace function public.sessao_ativa()
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select case
    when nullif(auth.jwt()->>'session_id','') is null then null
    else exists (select 1 from auth.sessions s
                  where s.id = (auth.jwt()->>'session_id')::uuid)
  end;
$$;


-- ---------------------------------------------------------------------
-- 2) Quem está logado agora (uma linha por sessão / aparelho)
-- ---------------------------------------------------------------------
create or replace function public.admin_listar_sessoes()
returns table(sessao_id uuid, conta_id uuid, email text, nome text, papel text,
              criada_em timestamptz, ultima_atividade timestamptz,
              aparelho text, ip text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'acesso negado'; end if;
  return query
  select s.id, s.user_id, u.email::text, p.nome::text, p.papel::text,
         s.created_at,
         greatest(s.updated_at,
                  nullif(to_jsonb(s)->>'refreshed_at','')::timestamptz,
                  s.created_at),
         to_jsonb(s)->>'user_agent',
         to_jsonb(s)->>'ip'
    from auth.sessions s
    join auth.users u   on u.id = s.user_id
    left join public.perfis p on p.id = s.user_id
   order by 7 desc nulls last;
end $$;


-- ---------------------------------------------------------------------
-- 3) Todas as contas, com último login, nº de sessões e bloqueio
-- ---------------------------------------------------------------------
create or replace function public.admin_listar_contas()
returns table(conta_id uuid, email text, nome text, papel text, vendedor text,
              ultimo_login timestamptz, bloqueada_ate timestamptz, sessoes int)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'acesso negado'; end if;
  return query
  select u.id, u.email::text, p.nome::text, p.papel::text, p.vendedor::text,
         u.last_sign_in_at, u.banned_until,
         (select count(*)::int from auth.sessions s where s.user_id = u.id)
    from auth.users u
    left join public.perfis p on p.id = u.id
   order by u.last_sign_in_at desc nulls last;
end $$;


-- ---------------------------------------------------------------------
-- 4) Desconectar UMA sessão (um aparelho)
-- ---------------------------------------------------------------------
create or replace function public.admin_derrubar_sessao(p_sessao uuid)
returns int
language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'acesso negado'; end if;
  delete from auth.refresh_tokens r where (to_jsonb(r)->>'session_id') = p_sessao::text;
  delete from auth.sessions where id = p_sessao;
  get diagnostics n = row_count;
  return n;
end $$;


-- ---------------------------------------------------------------------
-- 5) Desconectar TODOS os aparelhos de uma conta
-- ---------------------------------------------------------------------
create or replace function public.admin_derrubar_conta(p_conta uuid)
returns int
language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'acesso negado'; end if;
  delete from auth.refresh_tokens where user_id = p_conta::text;
  delete from auth.sessions where user_id = p_conta;
  get diagnostics n = row_count;
  return n;
end $$;


-- ---------------------------------------------------------------------
-- 6) Desconectar TODO MUNDO — com ou sem incluir quem está clicando
-- ---------------------------------------------------------------------
create or replace function public.admin_derrubar_todos(p_incluir_eu boolean default false)
returns int
language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'acesso negado'; end if;
  if p_incluir_eu then
    delete from auth.refresh_tokens;
    delete from auth.sessions;
  else
    delete from auth.refresh_tokens where user_id <> auth.uid()::text;
    delete from auth.sessions where user_id <> auth.uid();
  end if;
  get diagnostics n = row_count;
  return n;
end $$;


-- ---------------------------------------------------------------------
-- 7) Bloquear / desbloquear uma conta
--    Bloqueada = não entra nem com a senha certa (e já é desconectada).
--    Desbloquear devolve o acesso com a MESMA senha de antes.
--    Ninguém consegue bloquear a si mesmo (evita se trancar fora).
-- ---------------------------------------------------------------------
create or replace function public.admin_bloquear_conta(p_conta uuid, p_bloquear boolean)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'acesso negado'; end if;
  if p_conta = auth.uid() then raise exception 'voce nao pode bloquear a propria conta'; end if;
  update auth.users
     set banned_until = case when p_bloquear then now() + interval '100 years' else null end
   where id = p_conta;
  if p_bloquear then
    delete from auth.refresh_tokens where user_id = p_conta::text;
    delete from auth.sessions where user_id = p_conta;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 8) Situação da blindagem (o painel mostra se o bloqueio imediato está ativo)
-- ---------------------------------------------------------------------
create or replace function public.admin_acessos_status()
returns json
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'acesso negado'; end if;
  return json_build_object(
    'blindagem_tabelas', (select count(*) from pg_policies
                           where schemaname = 'public'
                             and policyname = 'sessao_ativa_obrigatoria'));
end $$;


-- ---------------------------------------------------------------------
-- Permissões: só usuário logado chama (e cada função confere se é admin)
-- ---------------------------------------------------------------------
revoke all on function public.sessao_ativa()                       from public, anon;
revoke all on function public.admin_listar_sessoes()               from public, anon;
revoke all on function public.admin_listar_contas()                from public, anon;
revoke all on function public.admin_derrubar_sessao(uuid)          from public, anon;
revoke all on function public.admin_derrubar_conta(uuid)           from public, anon;
revoke all on function public.admin_derrubar_todos(boolean)        from public, anon;
revoke all on function public.admin_bloquear_conta(uuid, boolean)  from public, anon;
revoke all on function public.admin_acessos_status()               from public, anon;

grant execute on function public.sessao_ativa()                      to authenticated;
grant execute on function public.admin_listar_sessoes()              to authenticated;
grant execute on function public.admin_listar_contas()               to authenticated;
grant execute on function public.admin_derrubar_sessao(uuid)         to authenticated;
grant execute on function public.admin_derrubar_conta(uuid)          to authenticated;
grant execute on function public.admin_derrubar_todos(boolean)       to authenticated;
grant execute on function public.admin_bloquear_conta(uuid, boolean) to authenticated;
grant execute on function public.admin_acessos_status()              to authenticated;

-- ---------------------------------------------------------------------
-- 9) Trocar a senha de uma conta (o ADMIN digita a nova senha no Portal)
--    Usa o mesmo formato de senha do login do Supabase (bcrypt).
--    Quem estava logado com a senha antiga é desconectado na hora.
--    (Para a própria conta, o Portal usa o caminho padrão do Supabase.)
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

create or replace function public.admin_definir_senha(p_conta uuid, p_senha text)
returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not public.is_admin() then raise exception 'acesso negado'; end if;
  if p_senha is null or length(p_senha) < 8 then
    raise exception 'a senha precisa ter pelo menos 8 caracteres';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = p_conta;
  if not found then raise exception 'conta nao encontrada'; end if;
  delete from auth.refresh_tokens where user_id = p_conta::text;
  delete from auth.sessions where user_id = p_conta;
end $$;

revoke all on function public.admin_definir_senha(uuid, text) from public, anon;
grant execute on function public.admin_definir_senha(uuid, text) to authenticated;

-- =====================================================================
--  FIM. Ninguém foi desconectado. Recarregue o Portal (F5): a aba
--  "🔐 Acessos" aparece para os admins.
-- =====================================================================
