# Publicar o Woods Web no Cloudflare (grátis)

Antes: termine os passos 1 a 4 de [woods-web.md](woods-web.md) (projeto Supabase, migration, sua conta e as chaves),
e confira que a pasta `web/` já está no GitHub (`rodrgo07/Painel-Woods`, branch `main`).

O Cloudflare hoje cria um projeto **Worker** quando você conecta um repositório em **Workers e Pages**.
O Woods Web já vem pronto para isso: `web/wrangler.jsonc` diz para publicar a pasta `dist/` como site estático.

## 1. Criar (ou corrigir) o projeto

**Workers e Pages** → **Criar** → **Importar um repositório** → `rodrgo07/Painel-Woods`.
Se o projeto `woods-web` já existe, abra **woods-web** → **Configurações** → seção **Compilações**.

Em **Configuração da build**, deixe assim:

| Campo | Valor |
|---|---|
| Ramificação de produção | `main` |
| **Comando da build** | `npm run build` |
| **Comando de implantação** | `npx wrangler deploy` |
| **Diretório raiz** | `/web` (não deixe `/`: a raiz é o app de Windows) |

Opcional, em **Compilar caminhos de inspeção** → **Incluir caminhos**: troque `*` por `web/*`, para o site só
ser refeito quando o painel web mudar.

## 2. Variáveis (no lugar certo)

As variáveis `VITE_` entram **na build**, não no tempo de execução.

Use **Configurações** → **Compilações** → **Variáveis e segredos** → **Adicionar**
(e **não** a seção "Variáveis e segredos em tempo de execução" do topo da página):

| Tipo | Nome | Valor |
|---|---|---|
| Texto | `VITE_SUPABASE_URL` | URL do projeto Supabase, ex.: `https://abcdxyz.supabase.co` |
| Texto | `VITE_SUPABASE_ANON_KEY` | a chave **publishable** (`sb_publishable_…`) ou **anon** (`eyJ…`) |
| Texto | `NODE_VERSION` | `22` |

Os dois `VITE_` são públicos (vão para o navegador). **Nunca** cadastre a `sb_secret_…` nem a `service_role`.

## 3. Publicar

**Implantações** → na última implantação, **…** → **Tentar novamente** (ou faça um push no `main`).
Em 1 a 2 minutos aparece o endereço, algo como `https://woods-web.<sua-conta>.workers.dev`
(em **Visão geral** ou **Domínios**).

Depois, no Supabase: **Authentication** → **URL Configuration** → **Site URL** = esse endereço.

## Se a build falhar

Clique em **Falha na última build** → **Visualizar build** e procure a primeira linha vermelha:

| Mensagem | Causa |
|---|---|
| `Missing script: "build"` ou não acha `web` | Diretório raiz não é `/web`, ou a pasta `web/` não está no GitHub |
| `Faltam VITE_SUPABASE_URL…` (na tela do site) | Variáveis cadastradas em "tempo de execução" em vez de **Compilações → Variáveis e segredos**. Corrija e rode a build de novo |
| `Missing entry-point` / pede `main` | Falta `web/wrangler.jsonc` no GitHub |
| Erro de versão do Node / Vite | Falta `NODE_VERSION` = `22` |

## O que já vem configurado

- `web/wrangler.jsonc`: site estático a partir de `dist/`, qualquer caminho cai no `index.html`.
- `web/public/_headers`: cabeçalhos de segurança (CSP só para o próprio site e `*.supabase.co`, sem iframe,
  `noindex`, `no-referrer`). Se o Supabase tiver domínio próprio, acrescente-o em `connect-src` e `img-src`.

## Domínio próprio (opcional)

**woods-web** → **Domínios** → adicionar, por exemplo, `painel.seudominio.com.br`.
Depois atualize o **Site URL** no Supabase.

## Conferir que está privado

1. Abra o endereço numa janela anônima: só aparece a tela de login.
2. Senha errada: "E-mail ou senha incorretos".
3. Depois de **Sair**, abrir `/#/sites` volta para o login.
