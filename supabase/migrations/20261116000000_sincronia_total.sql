-- Sincronização total entre os computadores do Painel Woods (PC de casa e notebooks).
-- Além dos metadados do Woods Web, agora vão para a conta do usuário:
--   conversas      histórico do painel e a sessão do Claude de cada lead (arquivos .gz no bucket privado "conversas")
--   preferencias   modelo, nome e e-mail dos commits e as permissões "Sempre" (uma linha por conta)
--   travas         qual computador está com o Claude trabalhando em cada lead (evita dois mexendo no mesmo site)
-- E uma proteção: um computador com o WOODS desatualizado não sobrescreve um projeto com dados mais antigos.
-- Mesmo padrão da migration anterior: owner_id em tudo, RLS só para o dono, anon sem acesso.

-- ---------- Conversas ----------
create table public.conversas (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  projeto_slug text not null check (projeto_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(projeto_slug) <= 120),
  versao bigint not null check (versao > 0),          -- sobe a cada envio; o envio só vale se a versão não mudou (sem atropelar)
  sessao_id text check (sessao_id is null or sessao_id ~ '^[A-Za-z0-9-]{8,80}$'),
  painel_sha text check (painel_sha is null or painel_sha ~ '^[0-9a-f]{64}$'),
  sessao_sha text check (sessao_sha is null or sessao_sha ~ '^[0-9a-f]{64}$'),
  dispositivo_id uuid,
  atualizado_em timestamptz not null default now(),
  primary key (owner_id, projeto_slug)
);

-- ---------- Preferências (uma linha por conta) ----------
create table public.preferencias (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  versao bigint not null check (versao > 0),
  dados jsonb not null default '{}'::jsonb check (pg_column_size(dados) <= 64000),
  dispositivo_id uuid,
  atualizado_em timestamptz not null default now()
);

-- ---------- Travas: um computador por lead enquanto o Claude trabalha ----------
create table public.travas (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  projeto_slug text not null check (projeto_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(projeto_slug) <= 120),
  dispositivo_id uuid not null,
  maquina text check (length(maquina) <= 100),
  desde timestamptz not null default now(),
  renovada_em timestamptz not null default now(),
  primary key (owner_id, projeto_slug)
);

alter table public.conversas enable row level security;
alter table public.preferencias enable row level security;
alter table public.travas enable row level security;

do $$
declare t text;
begin
  foreach t in array array['conversas', 'preferencias', 'travas'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy "%s: dono lê" on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t, t);
    execute format('create policy "%s: dono cria" on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t, t);
    execute format('create policy "%s: dono altera" on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t, t);
    execute format('create policy "%s: dono apaga" on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t, t);
  end loop;
end $$;

-- ---------- Storage: bucket privado "conversas", pasta <owner_id>/<slug>/<arquivo>.gz ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('conversas', 'conversas', false, 52428800, array['application/gzip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "conversas: dono lê" on storage.objects for select to authenticated
  using (bucket_id = 'conversas' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "conversas: dono envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'conversas' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "conversas: dono troca" on storage.objects for update to authenticated
  using (bucket_id = 'conversas' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'conversas' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "conversas: dono apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'conversas' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------- Projetos: dado mais antigo não sobrescreve o mais novo ----------
-- Um notebook que ficou dias desligado manda o que tem; se a ficha dele é mais velha que a da nuvem, a linha fica como está.
create function public.manter_projeto_mais_novo() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.atualizado_local_em is not null and old.atualizado_local_em is not null
     and new.atualizado_local_em < old.atualizado_local_em then
    return old;
  end if;
  return new;
end $$;
create trigger projetos_mais_novo before update on public.projetos for each row execute function public.manter_projeto_mais_novo();
