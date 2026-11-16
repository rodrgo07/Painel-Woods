-- Woods Web: metadados dos projetos que o Painel Woods (desktop) sincroniza.
-- Cada linha pertence a um usuário (owner_id). RLS em todas as tabelas: cada um só vê e altera o que é seu.
-- O papel anon não tem acesso a nada.

-- ---------- Projetos (um por lead do WOODS: vault/20-leads/<slug>.md) ----------
create table public.projetos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 120), -- identificador local estável
  nome text not null check (length(nome) <= 300),
  instagram text check (instagram is null or instagram ~* '^https://(www\.)?instagram\.com/'),
  cidade text check (length(cidade) <= 200),
  responsavel text check (length(responsavel) <= 100),
  nicho text check (length(nicho) <= 100),
  status text check (length(status) <= 60),                 -- cabeçalho da ficha: pesquisa, site pronto, aprovado, publicado…
  variante_a_pronta boolean not null default false,         -- sites/<slug>/dist/a/index.html existe
  variante_b_pronta boolean not null default false,
  url_a text check (url_a is null or url_a ~* '^https?://'), -- "Link variante A" da ficha (preenchido na publicação)
  url_b text check (url_b is null or url_b ~* '^https?://'),
  repositorio_url text check (repositorio_url is null or repositorio_url ~* '^https://github\.com/'),
  criado_local_em timestamptz,
  atualizado_local_em timestamptz,
  erro_sincronia text check (length(erro_sincronia) <= 500),
  sincronizado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, slug)
);
create index projetos_owner_atualizado on public.projetos (owner_id, atualizado_local_em desc);
create index projetos_owner_status on public.projetos (owner_id, status);

-- ---------- Prévias (os 4 prints: a-390, b-390, a-1440, b-1440) no bucket privado "previas" ----------
create table public.previas (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  projeto_slug text not null,
  nome text not null check (nome in ('a-390', 'b-390', 'a-1440', 'b-1440')),
  variante text generated always as (left(nome, 1)) stored,
  aparelho text generated always as (case when nome like '%-390' then 'celular' else 'desktop' end) stored,
  storage_path text not null check (length(storage_path) <= 300),
  atualizado_local_em timestamptz not null,
  enviado_em timestamptz not null default now(),
  primary key (owner_id, projeto_slug, nome),
  foreign key (owner_id, projeto_slug) references public.projetos (owner_id, slug) on delete cascade on update cascade
);

-- ---------- Histórico de eventos por projeto ----------
-- O id vem do desktop (derivado do evento), então reenviar o mesmo evento não duplica.
create table public.eventos (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  projeto_slug text not null,
  tipo text not null check (tipo in (
    'importado', 'criado', 'status', 'variante_a_pronta', 'variante_b_pronta', 'previas_prontas',
    'publicado', 'trabalho_iniciado', 'trabalho_concluido', 'trabalho_com_erro')),
  detalhe jsonb not null default '{}'::jsonb check (pg_column_size(detalhe) <= 4000),
  ocorrido_em timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (owner_id, projeto_slug) references public.projetos (owner_id, slug) on delete cascade on update cascade
);
create index eventos_projeto_data on public.eventos (owner_id, projeto_slug, ocorrido_em desc);

-- ---------- Desktops conectados (estado da integração) ----------
create table public.dispositivos (
  id uuid primary key,                                       -- gerado no desktop na primeira conexão
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome text check (length(nome) <= 100),
  versao_app text check (length(versao_app) <= 40),
  conectado boolean not null default true,
  ultimo_contato timestamptz not null default now(),
  ultima_sincronizacao timestamptz,
  pendentes integer not null default 0 check (pendentes >= 0),
  ultimo_erro text check (length(ultimo_erro) <= 500)
);
create index dispositivos_owner on public.dispositivos (owner_id);

-- ---------- updated_at ----------
create function public.tocar_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger projetos_updated_at before update on public.projetos for each row execute function public.tocar_updated_at();

-- ---------- RLS: só o dono, em todas as operações ----------
alter table public.projetos enable row level security;
alter table public.previas enable row level security;
alter table public.eventos enable row level security;
alter table public.dispositivos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['projetos', 'previas', 'eventos', 'dispositivos'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy "%s: dono lê" on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t, t);
    execute format('create policy "%s: dono cria" on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t, t);
    execute format('create policy "%s: dono altera" on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t, t);
    execute format('create policy "%s: dono apaga" on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t, t);
  end loop;
end $$;

-- ---------- Storage: bucket privado "previas", pasta <owner_id>/<slug>/<nome>.jpg ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('previas', 'previas', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "previas: dono lê" on storage.objects for select to authenticated
  using (bucket_id = 'previas' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "previas: dono envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'previas' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "previas: dono troca" on storage.objects for update to authenticated
  using (bucket_id = 'previas' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'previas' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "previas: dono apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'previas' and (storage.foldername(name))[1] = (select auth.uid())::text);
