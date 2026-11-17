-- Integração (versão 1.2.0 do Painel Woods): leva o banco ao modelo final, com você e o sócio na mesma equipe.
-- Roda DEPOIS de 20261115000000_woods_web.sql e 20261116000000_sincronia_total.sql (as duas já estão em produção).
-- Substitui a antiga 20261116000000_equipe.sql, que nunca foi aplicada.
--
-- ATENÇÃO: rode no mesmo dia em que instalar a 1.2.0, com o Painel Woods FECHADO em todos os computadores.
-- Esta migration troca a chave (owner_id, slug) por (equipe_id, slug); a versão 1.0/1.1 instalada para de sincronizar.
--
-- O que muda:
--   - equipes / membros: quem faz parte de qual equipe (só se altera pelo SQL Editor, veja docs/woods-web.md)
--   - projetos, previas, eventos e dispositivos ganham equipe_id; owner_id passa a ser "quem enviou por último"
--   - travas: passam a ser da equipe (equipe_id, projeto_slug) e mostram quem está trabalhando no Woods Web.
--     O banco só aceita a trava de um lead de quem é o Responsável dele (membros.nome = projetos.responsavel)
--   - conversas e preferencias continuam de cada conta (cada um só vê as próprias)
--   - projetos.removido_em: lead apagado do WOODS some do painel, sem apagar o histórico
--   - um gatilho só contra versão velha (recusar_versao_velha), em projetos e previas; sai o projetos_mais_novo
--   - prints no bucket em previas/<equipe_id>/<slug>/<nome>.jpg
--
-- Dados que já existem: todos os usuários atuais entram na equipe "Woods" e as linhas passam a ser dela.
-- O Painel Woods reenvia sozinho os prints para o caminho novo na primeira sincronização depois da atualização.

-- ---------- Equipes e membros ----------
create table public.equipes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(nome) between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.membros (
  equipe_id uuid not null references public.equipes (id) on delete cascade,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  nome text check (length(nome) <= 40),   -- como aparece no painel; igual ao "Responsável" das fichas (ex.: R Host)
  created_at timestamptz not null default now(),
  primary key (equipe_id, usuario_id)
);
create index membros_usuario on public.membros (usuario_id);

-- Equipes de quem está logado. security definer: lê membros sem passar pelo RLS (evita a regra chamar a si mesma)
create function public.minhas_equipes() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select equipe_id from public.membros where usuario_id = (select auth.uid())
$$;
revoke execute on function public.minhas_equipes() from public, anon;
grant execute on function public.minhas_equipes() to authenticated;

-- Para o SQL Editor: põe uma conta (já criada em Authentication → Users) na equipe.
--   select public.adicionar_membro('socio@exemplo.com', 'L Host');
-- Sem equipe informada, usa a mais antiga (normalmente a única). Rodar de novo só troca o nome.
create function public.adicionar_membro(email text, nome text default null, equipe uuid default null) returns text
language plpgsql security definer set search_path = '' as $$
declare u uuid; e uuid;
begin
  select id into u from auth.users where lower(auth.users.email) = lower(adicionar_membro.email);
  if u is null then raise exception 'Não existe conta com o e-mail %. Crie em Authentication → Users primeiro.', adicionar_membro.email; end if;
  e := coalesce(equipe, (select id from public.equipes order by created_at limit 1));
  if e is null then raise exception 'Nenhuma equipe criada.'; end if;
  insert into public.membros (equipe_id, usuario_id, nome) values (e, u, nullif(trim(nome), ''))
  on conflict (equipe_id, usuario_id) do update set nome = excluded.nome;
  return format('%s está na equipe %s', adicionar_membro.email, (select q.nome from public.equipes q where q.id = e));
end $$;
-- Só o dono do banco (SQL Editor) roda. Pelo site ninguém consegue se pôr numa equipe
revoke execute on function public.adicionar_membro(text, text, uuid) from public, anon, authenticated;

alter table public.equipes enable row level security;
alter table public.membros enable row level security;
grant select on public.equipes, public.membros to authenticated;
revoke all on public.equipes, public.membros from anon;
create policy "equipes: membro lê" on public.equipes for select to authenticated using (id in (select public.minhas_equipes()));
create policy "membros: membro lê a equipe" on public.membros for select to authenticated using (equipe_id in (select public.minhas_equipes()));

-- ---------- equipe_id nas tabelas, com os dados que já existem ----------
alter table public.projetos add column equipe_id uuid references public.equipes (id) on delete cascade;
alter table public.previas add column equipe_id uuid references public.equipes (id) on delete cascade;
alter table public.eventos add column equipe_id uuid references public.equipes (id) on delete cascade;
alter table public.dispositivos add column equipe_id uuid references public.equipes (id) on delete cascade;

do $$
declare e uuid;
begin
  insert into public.equipes (nome) values ('Woods') returning id into e;
  -- O cadastro do Woods Web é fechado: quem tem conta hoje é da equipe
  insert into public.membros (equipe_id, usuario_id) select e, id from auth.users;
  update public.projetos set equipe_id = e;
  update public.previas set equipe_id = e;
  update public.eventos set equipe_id = e;
  update public.dispositivos set equipe_id = e;
end $$;

-- Chaves por equipe no lugar das chaves por dono
alter table public.previas drop constraint previas_owner_id_projeto_slug_fkey;
alter table public.eventos drop constraint eventos_owner_id_projeto_slug_fkey;
alter table public.previas drop constraint previas_pkey;
alter table public.projetos drop constraint projetos_owner_id_slug_key;

-- Se duas contas já tinham o mesmo lead, fica a versão mais nova
delete from public.projetos p using public.projetos q
where p.equipe_id = q.equipe_id and p.slug = q.slug
  and (coalesce(p.atualizado_local_em, '-infinity'), p.id) < (coalesce(q.atualizado_local_em, '-infinity'), q.id);
delete from public.previas p using public.previas q
where p.equipe_id = q.equipe_id and p.projeto_slug = q.projeto_slug and p.nome = q.nome
  and (p.atualizado_local_em, p.storage_path) < (q.atualizado_local_em, q.storage_path);

alter table public.projetos alter column equipe_id set not null;
alter table public.previas alter column equipe_id set not null;
alter table public.eventos alter column equipe_id set not null;
alter table public.dispositivos alter column equipe_id set not null;

alter table public.projetos add constraint projetos_equipe_slug_key unique (equipe_id, slug);
alter table public.previas add primary key (equipe_id, projeto_slug, nome);
alter table public.previas add constraint previas_projeto_fkey foreign key (equipe_id, projeto_slug)
  references public.projetos (equipe_id, slug) on delete cascade on update cascade;
alter table public.eventos add constraint eventos_projeto_fkey foreign key (equipe_id, projeto_slug)
  references public.projetos (equipe_id, slug) on delete cascade on update cascade;

drop index public.projetos_owner_atualizado;
drop index public.projetos_owner_status;
drop index public.eventos_projeto_data;
drop index public.dispositivos_owner;
create index projetos_equipe_atualizado on public.projetos (equipe_id, atualizado_local_em desc);
create index eventos_projeto_data on public.eventos (equipe_id, projeto_slug, ocorrido_em desc);
create index dispositivos_equipe on public.dispositivos (equipe_id);

comment on column public.projetos.owner_id is 'Quem enviou a versão atual (último a sincronizar)';

-- ---------- Lead apagado do WOODS ----------
alter table public.projetos add column removido_em timestamptz;

-- ---------- Trava contra versão velha ----------
-- O PC com o WOODS atrasado manda uma data mais antiga (a data do commit da ficha ou do print): o banco ignora.
create function public.recusar_versao_velha() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.atualizado_local_em < old.atualizado_local_em then
    return null; -- mantém a linha como está, sem erro (o envio conta como feito)
  end if;
  return new;
end $$;
create trigger projetos_versao_velha before update on public.projetos for each row execute function public.recusar_versao_velha();
create trigger previas_versao_velha before update on public.previas for each row execute function public.recusar_versao_velha();
-- O da sincronia total fazia o mesmo só em projetos: fica um gatilho só
drop trigger projetos_mais_novo on public.projetos;
drop function public.manter_projeto_mais_novo();

-- ---------- Travas: um computador por lead, só o responsável do lead ----------
alter table public.travas add column equipe_id uuid references public.equipes (id) on delete cascade;
alter table public.travas add column quem text check (length(quem) <= 100); -- nome do membro, para o Woods Web
update public.travas set equipe_id = (select id from public.equipes order by created_at limit 1);
delete from public.travas t using public.travas u -- duas contas com o mesmo lead travado: fica a mais recente
where t.equipe_id = u.equipe_id and t.projeto_slug = u.projeto_slug and (t.renovada_em, t.owner_id) < (u.renovada_em, u.owner_id);
alter table public.travas alter column equipe_id set not null;
alter table public.travas drop constraint travas_pkey;
alter table public.travas add primary key (equipe_id, projeto_slug);
-- Sem chave para projetos: um lead novo é travado antes de a linha dele chegar ao banco

-- Quem está logado pode travar o lead? Pode se o lead ainda não está no banco, não tem responsável,
-- ou se o responsável é o nome dele na equipe. security definer: lê membros e projetos sem passar pelo RLS
create function public.pode_travar(equipe uuid, slug text) returns boolean
language sql stable security definer set search_path = '' as $$
  select equipe in (select public.minhas_equipes()) and not exists (
    select 1 from public.projetos p
    where p.equipe_id = equipe and p.slug = pode_travar.slug and p.removido_em is null
      and nullif(trim(p.responsavel), '') is not null
      and p.responsavel is distinct from (
        select m.nome from public.membros m where m.equipe_id = equipe and m.usuario_id = (select auth.uid())))
$$;
revoke execute on function public.pode_travar(uuid, text) from public, anon;
grant execute on function public.pode_travar(uuid, text) to authenticated;

drop policy "travas: dono lê" on public.travas;
drop policy "travas: dono cria" on public.travas;
drop policy "travas: dono altera" on public.travas;
drop policy "travas: dono apaga" on public.travas;
create policy "travas: equipe lê" on public.travas for select to authenticated
  using (equipe_id in (select public.minhas_equipes()));
create policy "travas: responsável trava" on public.travas for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.pode_travar(equipe_id, projeto_slug));
-- Renovar a própria trava, ou tomar uma que venceu (10 min sem renovar: o PC desligou no meio)
create policy "travas: responsável renova" on public.travas for update to authenticated
  using (equipe_id in (select public.minhas_equipes()) and (owner_id = (select auth.uid()) or renovada_em < now() - interval '10 minutes'))
  with check (owner_id = (select auth.uid()) and public.pode_travar(equipe_id, projeto_slug));
create policy "travas: dono solta" on public.travas for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------- RLS: a equipe lê; cada um só escreve em nome próprio ----------
do $$
declare t text;
begin
  foreach t in array array['projetos', 'previas', 'eventos', 'dispositivos'] loop
    execute format('drop policy "%s: dono lê" on public.%I', t, t);
    execute format('drop policy "%s: dono cria" on public.%I', t, t);
    execute format('drop policy "%s: dono altera" on public.%I', t, t);
    execute format('drop policy "%s: dono apaga" on public.%I', t, t);
  end loop;
  foreach t in array array['projetos', 'previas', 'eventos', 'dispositivos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy "%s: equipe lê" on public.%I for select to authenticated using (equipe_id in (select public.minhas_equipes()))', t, t);
    execute format('create policy "%s: equipe cria" on public.%I for insert to authenticated with check (equipe_id in (select public.minhas_equipes()) and owner_id = (select auth.uid()))', t, t);
    execute format('create policy "%s: equipe altera" on public.%I for update to authenticated using (equipe_id in (select public.minhas_equipes())) with check (equipe_id in (select public.minhas_equipes()) and owner_id = (select auth.uid()))', t, t);
    execute format('create policy "%s: equipe apaga" on public.%I for delete to authenticated using (equipe_id in (select public.minhas_equipes()))', t, t);
  end loop;
end $$;

-- ---------- Storage: previas/<equipe_id>/<slug>/<nome>.jpg ----------
drop policy "previas: dono lê" on storage.objects;
drop policy "previas: dono envia" on storage.objects;
drop policy "previas: dono troca" on storage.objects;
drop policy "previas: dono apaga" on storage.objects;

create policy "previas: equipe lê" on storage.objects for select to authenticated
  using (bucket_id = 'previas' and (storage.foldername(name))[1] in (select e::text from public.minhas_equipes() e));
create policy "previas: equipe envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'previas' and (storage.foldername(name))[1] in (select e::text from public.minhas_equipes() e));
create policy "previas: equipe troca" on storage.objects for update to authenticated
  using (bucket_id = 'previas' and (storage.foldername(name))[1] in (select e::text from public.minhas_equipes() e))
  with check (bucket_id = 'previas' and (storage.foldername(name))[1] in (select e::text from public.minhas_equipes() e));
create policy "previas: equipe apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'previas' and (storage.foldername(name))[1] in (select e::text from public.minhas_equipes() e));
