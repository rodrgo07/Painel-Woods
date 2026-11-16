# Woods Web: instalação e configuração

O Woods Web é um painel **privado e online** com todos os sites gerados pelo Painel Woods. Você abre pelo navegador
(computador ou celular) sem precisar do seu PC ligado.

- O **Painel Woods (Windows)** continua fazendo tudo como antes: leads, Claude, prévias, aprovação e publicação.
- Um **serviço de sincronização** dentro do Painel Woods envia só os *metadados* dos projetos para o **Supabase**
  (banco PostgreSQL + login + armazenamento das imagens).
- O **Woods Web** (pasta `web/`) é um site estático hospedado de graça no **Cloudflare Pages** que lê esses dados.

Tudo é gratuito nos planos free do Supabase e do Cloudflare. Tempo total: uns 30 minutos.

```
Painel Woods (seu PC)                Supabase (nuvem)                    Woods Web (Cloudflare Pages)
 WOODS/vault/20-leads/*.md   ──►  tabelas projetos, eventos,   ◄──  navegador / celular
 WOODS/sites/<slug>/prints   ──►  previas, dispositivos           (login com e-mail e senha)
 (só leitura)                      bucket privado "previas"
```

## O que é enviado (e o que não é)

| Enviado | Não enviado, nunca |
|---|---|
| Nome, slug, Instagram, cidade, responsável e nicho da ficha | Chave da API cifrada (o cofre do Windows só abre no computador que a gravou) |
| Conversas do painel e sessões do Claude de cada lead, compactadas, no bucket privado `conversas` (para continuar de outro computador; veja [sincronia.md](sincronia.md)) | |
| Preferências: modelo, nome e e-mail dos commits, permissões "Sempre" | |
| Qual computador está com o Claude em cada lead (trava) | |
| Status da ficha (`pesquisa`, `site pronto`, `aprovado`, `publicado`…) | Chave da API da Anthropic, login do Claude, credenciais do GitHub |
| Se as variantes A e B já foram geradas | O resto da ficha (WhatsApp, endereço, observações, ligação) |
| Links A e B da ficha (os endereços publicados) | Código dos sites, fotos dos clientes, `site.config.json` |
| Link da pasta do lead no repositório WOODS do GitHub | Senha do Woods Web (só passa uma vez para entrar) |
| Os 4 prints de revisão (`a-390`, `b-390`, `a-1440`, `b-1440`) | |
| Eventos: criado, mudança de status, variante gerada, prints prontos, publicado, Claude começou/terminou | |

---

## 1. Criar o projeto no Supabase

1. Entre em <https://supabase.com> e crie uma conta (pode usar o GitHub).
2. **New project**. Nome: `woods-web`. Crie uma senha forte para o banco e guarde num gerenciador de senhas
   (ela não é usada pelo Woods Web, mas o Supabase pede). Região: **South America (São Paulo)**. Plano **Free**.
3. Espere o projeto ficar pronto (1 a 2 minutos).

## 2. Criar as tabelas (migration)

1. No menu da esquerda, abra **SQL Editor** → **New query**.
2. Abra o arquivo [`supabase/migrations/20261115000000_woods_web.sql`](../supabase/migrations/20261115000000_woods_web.sql)
   deste repositório, copie **todo** o conteúdo, cole no editor e clique em **Run**. Depois faça o mesmo com
   [`supabase/migrations/20261116000000_sincronia_total.sql`](../supabase/migrations/20261116000000_sincronia_total.sql)
   (conversas, preferências e travas da sincronização entre computadores).
3. Deve aparecer `Success. No rows returned`.
4. Confira em **Table Editor**: existem `projetos`, `previas`, `eventos` e `dispositivos`, cada uma com o selo **RLS enabled**.
5. Confira em **Storage**: existe o bucket `previas`, **privado** (sem o selo "Public").

> Quem usa a Supabase CLI pode, em vez disso, rodar `supabase link` e `supabase db push` na raiz do repositório.

O que a migration cria:
- `projetos`: um por lead, com chave única `(owner_id, slug)`. O slug é o identificador estável do lead no WOODS.
- `previas`: os 4 prints de cada projeto, apontando para o arquivo no bucket.
- `eventos`: histórico. O id vem do desktop e é sempre o mesmo para o mesmo acontecimento, então reenviar não duplica.
- `dispositivos`: o Painel Woods conectado, último contato, última sincronização e envios pendentes.
- **RLS em tudo**: cada tabela só deixa ler, criar, alterar e apagar linhas com `owner_id = auth.uid()`.
  O papel `anon` (quem não entrou) não acessa nada. As imagens ficam em `previas/<id-do-usuário>/<slug>/` e
  só o dono lê ou envia.

## 3. Criar a sua conta (a única)

1. **Authentication** → **Users** → **Add user** → **Create new user**.
2. Seu e-mail e uma senha forte. Marque **Auto Confirm User**. **Create user**.

### Fechar o cadastro para mais ninguém

Depois de criar a sua conta:

1. **Authentication** → **Sign In / Providers** (em versões antigas: **Providers** ou **Settings**).
2. Desligue **Allow new users to sign up** e salve.
3. Deixe o provedor **Email** ligado (é ele que permite entrar com e-mail e senha).

Mesmo que alguém conseguisse criar uma conta, o RLS só mostraria a essa pessoa as linhas dela (nenhuma).
Fechar o cadastro é a segunda tranca.

## 4. Pegar a URL e a chave pública

**Project Settings** → **API Keys** (ou **Data API** / **API**, conforme a versão do painel):

- **Project URL**: `https://xxxxxxxx.supabase.co`. Não fica na página API Keys: clique no botão verde **Connect**
  no topo do painel, ou abra **Integrations → Data API** (campo *API URL*). Também dá para montar com o
  *Project ID* de **Settings → General**: `https://<Project ID>.supabase.co`.
- **Chave pública**: a **anon** (começa com `eyJ`) ou a **publishable** (começa com `sb_publishable_`).

Esses dois valores são **públicos**: vão para o navegador e para o app. Quem protege os dados é o RLS.

> **Nunca** use a chave `service_role` nem a `sb_secret_…` em lugar nenhum do Woods Web ou do Painel Woods.
> O Painel Woods e o Woods Web recusam essas chaves se forem coladas por engano.

## 5. Publicar o Woods Web no Cloudflare Pages

Siga o guia [cloudflare-pages.md](cloudflare-pages.md). No fim você terá um endereço `https://woods-web-xxx.pages.dev`.

Depois, de volta ao Supabase: **Authentication** → **URL Configuration** → **Site URL** = esse endereço.
Não é obrigatório para entrar com senha, mas deixa os e-mails do Supabase (troca de senha) apontando para o lugar certo.

## 6. Conectar o Painel Woods

1. Abra o Painel Woods → **Configurações** (ícone ao lado de "Claude livre").
2. No cartão **Woods Web**, preencha:
   - **URL do projeto Supabase** e **Chave pública** (passo 4);
   - **E-mail** e **Senha** da sua conta (passo 3).
3. **Conectar**.

O app entra no Supabase, guarda **só o token de renovação**, cifrado pelo Windows (DPAPI, o mesmo cofre da chave
da API), e esquece a senha. A página do app nunca vê nenhum token. Na hora, ele faz a **sincronização inicial**
de todos os leads que já existem no WOODS (sem duplicar se você conectar de novo).

No cartão aparecem: conta conectada, última sincronização, envios pendentes e o último erro.
**Sincronizar agora** tenta já o que estiver esperando. **Desconectar** apaga a sessão do computador
(o que já está na nuvem continua lá).

## Como a sincronização funciona

- A cada **1 minuto** (e 3 segundos depois de o Claude começar ou terminar um trabalho) o serviço lê as fichas
  do WOODS, compara com a última foto e põe na fila só o que mudou.
- A fila fica em `%APPDATA%\PainelWoods\nuvem-estado.json`. **Sem internet ou com o Supabase fora**, nada se perde:
  as tentativas se espaçam (30 s, 1 min, 2 min… até 30 min) e o envio volta sozinho. Quando o PC acorda da suspensão,
  ele tenta na hora. O Painel Woods funciona normalmente o tempo todo.
- Tudo é **upsert** pela chave `(dono, slug)`: reenviar nunca cria linha repetida.
- Dado recusado pelo banco (não deveria acontecer) é tentado algumas vezes e depois descartado; o projeto aparece no
  Woods Web como **problema de sincronização**, com a mensagem.
- Um print só é enviado de novo quando o arquivo muda.
- O desktop avisa ao Woods Web que está vivo a cada 5 minutos (enquanto o app está aberto).

Arquivos no computador (`%APPDATA%\PainelWoods`):

| Arquivo | Conteúdo |
|---|---|
| `nuvem.json` | URL, chave pública, e-mail, id da conta e do aparelho, token de renovação **cifrado** |
| `nuvem-estado.json` | Fila pendente, última foto de cada lead, prints já enviados, última sincronização |
| `logs\painel-*.log` | Erros da sincronização (sem tokens nem senha) |

## Desenvolver o Woods Web no seu PC

Precisa de Node 22 ou mais novo.

```
cd web
copy .env.example .env.local   (edite com a URL e a chave pública)
npm install
npm run dev
```

- `npm test`: regras do painel (fases do status, filtros, integração, links seguros).
- `npm run build`: confere os tipos (TypeScript) e gera `web/dist/`.

Na raiz, `npm test` roda os testes do Painel Woods, incluindo os da sincronização (`test/sincronia.test.js`),
contra um Supabase falso, sem rede.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Woods Web mostra "sem configuração" | Faltam as variáveis no Cloudflare Pages. Cadastre e faça um novo deploy. |
| "As tabelas não existem no Supabase" | Rode a migration (passo 2). |
| "E-mail ou senha incorretos" | Confira o usuário em Authentication → Users. Para trocar a senha: **…** → Send password recovery, ou apague e crie de novo. |
| Painel Woods: "Essa é a chave service_role" | Copie a chave **anon**/**publishable**, não a secreta. |
| Desktop "sem contato" no Woods Web | O Painel Woods está fechado, sem internet, ou foi desconectado. Abra as configurações do app e veja o cartão Woods Web. |
| Painel Woods: "sessão expirada" | A sessão foi revogada (troca de senha, por exemplo). Conecte de novo. |
| Projeto pausado no Supabase | Projetos free sem uso por 7 dias são pausados. Clique em **Restore** no painel do Supabase. |
| Prévia indisponível | O lead ainda não tem os 4 prints em `sites/<slug>/prints/`, ou eles ainda estão na fila. |

## Fora do escopo desta versão

O Woods Web só **mostra** os dados. Ele não roda o Claude, não executa comandos no seu computador, não acessa os
arquivos do WOODS e não gera nem publica sites. Os sites dos clientes continuam sendo publicados pelo fluxo do WOODS
(Cloudflare Pages ligado ao repositório `WOODS`); o Cloudflare Pages deste guia hospeda só o próprio Woods Web.
