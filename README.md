# Painel Woods

Aplicativo de Windows para o repositório WOODS. Você cadastra o lead (nome + Instagram) e o Claude segue o
`vault/00-sistema/fluxo-novo-lead.md` do WOODS: pesquisa no Google e no Instagram, preenche o
`site.config.json`, cria as variantes A e B, faz SEO e gera os 4 prints. Tudo aparece no painel:
a prévia de A e B (celular e desktop), os prints, a ficha e a conversa com o Claude.

O app leva tudo dentro: Node, Git (com o Bash e o Credential Manager), o Claude Code (`claude.exe`) e o
Playwright MCP. A máquina não precisa de Node, git nem npm instalados.

## Instalar
- `Painel-Woods-Setup-<versão>.exe`: instala só para o seu usuário (sem pedir administrador), cria atalho no menu
  Iniciar e na área de trabalho e tem desinstalador. Ao desinstalar, ele pergunta se apaga os dados.
- `Painel-Woods-<versão>-portable.exe`: um arquivo só, sem instalar. Ele se extrai numa pasta temporária a cada
  abertura, então demora mais para abrir. Os dados ficam no mesmo lugar do instalado.

**Aviso do SmartScreen:** o app não é assinado. Na primeira vez o Windows mostra "O Windows protegeu o computador":
clique em **Mais informações** e depois em **Executar assim mesmo**. Com um certificado de assinatura o aviso some
(veja "Assinatura" abaixo).

## Primeira execução
O app abre nas Configurações e mostra o que falta. Cada passo pode ser refeito depois, no ícone ao lado de "Claude livre".
1. **Este computador**: navegador dos prints (Chrome; sem ele, Edge; sem nenhum, o botão baixa o Chromium), internet e espaço em disco.
2. **GitHub**: o WOODS é privado. Abre a janela de login do GitHub; o acesso fica no Gerenciador de Credenciais do Windows.
3. **WOODS**: clona `rodrgo07/WOODS` em `%APPDATA%\PainelWoods\WOODS` e instala as dependências (`npm ci`).
4. **Claude**: "Entrar com a conta do Claude" abre um terminal com o login do Claude Code. A alternativa é uma chave da
   API (cobrada por uso), guardada cifrada pelo Windows (DPAPI). Aqui também se escolhe o modelo.
5. **Assinatura dos commits**: nome e e-mail usados nos commits do WOODS.

Precisa de internet na primeira vez (clonar o WOODS, `npm ci` e, se for o caso, o Chromium).
Quem tinha a versão antiga pode importar as conversas em "Importar conversas de uma instalação antiga" (a pasta `dados`).

## Usar
- **Novo lead**: nome, Instagram, cidade e responsável. O painel cria a pasta e a ficha (já com Instagram e cidade) e o Claude segue o fluxo até os prints.
- **Logins e captcha**: o Playwright abre uma janela do navegador. Quando o Claude pedir, faça o login do Instagram ou do Cloudflare nessa janela e responda "feito" no painel.
- **Permissões**: o que está fora da lista liberada (`PERMITIDAS` em `painel.js`) aparece como um cartão com Permitir, Sempre ou Negar. `git push`, `curl` e `WebFetch` sempre pedem.
- **Ajustes**: escreva no campo da conversa ("troque a cor do botão da B", "use outra foto no hero").
- **Aprovar e publicar**: o botão aparece quando a ficha está em `site pronto`; o Claude segue as etapas 7 e 8.
- **Parar**: interrompe o Claude na hora e fecha o navegador dele.
- **WOODS em dia sozinho**: ao abrir e a cada 10 minutos, com o Claude parado, o app puxa as novidades do GitHub só avançando (`--ff-only`), sem janela de login. Se as novidades mexem nas dependências, ou se batem com trabalho local de um lead, ele não mexe em nada e avisa; aí vale o botão **Atualizar WOODS** (Configurações), que também instala as dependências.
- **Trabalho em equipe** (com o Woods Web conectado): antes de o Claude começar, o app avisa se o sócio está com o Claude no mesmo lead agora, e, num lead novo, se ele já existe na equipe.
- **Responsáveis** (Configurações): os nomes que aparecem em "Responsável" no novo lead. Use os mesmos nomes da equipe no Woods Web.
- **Versão nova do app**: quando sai uma Release nova no GitHub (`rodrgo07/Painel-Woods`), aparece um aviso com o link do instalador.

Um lead por vez: o navegador do Playwright é um só. Cada lead tem sua sessão do Claude, então dá para voltar dias
depois e continuar a conversa. Fechar a janela para o Claude e encerra tudo que o app abriu.

## Onde ficam os dados
Tudo em `%APPDATA%\PainelWoods`. Nada é gravado na pasta de instalação.

| Item | Onde |
|---|---|
| Repositório WOODS | `WOODS\` |
| Configurações (a chave da API fica cifrada) | `config.json` |
| Conversas e sessões | `conversas\<slug>.jsonl`, `sessoes.json` |
| Erros | `logs\painel-AAAA-MM-DD.log` |
| Chromium baixado (se precisou) | `navegadores\` |
| Woods Web: conexão (token cifrado) e fila de envio | `nuvem.json`, `nuvem-estado.json` |
| Espelho do WOODS entre computadores (última foto, conflito) | `espelho.json` |

Dois itens ficam fora dessa pasta, por conta de quem os guarda: o login do GitHub (Gerenciador de Credenciais do
Windows) e o login da conta do Claude (`%USERPROFILE%\.claude`, gravado pelo próprio Claude Code).

## Desenvolver
Precisa de Node 22 ou mais novo.
```
npm install
npm run ferramentas
npm start
```
- `npm install`: se o Electron não baixar o binário sozinho (npm novo bloqueia scripts de instalação), rode `npx install-electron`.
- `npm run ferramentas`: baixa o Node e o PortableGit para `vendor/`, conferindo o SHA-256 (uma vez só).
- `npm test`: slug, ficha, bloqueio de `../`, configuração, checagens do WOODS, atualização sem perder trabalho local e a sincronização do Woods Web (Supabase falso, sem rede).
- `.env` (opcional, veja `.env.exemplo`): só no `npm start`. O app instalado não lê `.env`.

### Gerar o instalador
```
npm run dist
```
Sai em `dist/`: `Painel-Woods-Setup-<versão>.exe` e `Painel-Woods-<versão>-portable.exe`. A versão vem do `package.json`.

### Lançar uma versão (atualização automática)
```
npm version 1.1.0 --no-git-tag-version
git commit -am "Versão 1.1.0"
git push
npm run lancar
```
`npm run lancar` gera o instalador e cria o release `v<versão>` como rascunho em `rodrgo07/Painel-Woods`, com o `latest.yml`.
Escreva as notas no GitHub e publique. O app instalado confere ao abrir e a cada hora, baixa em segundo plano e mostra
"Versão x pronta" na barra lateral: um clique reinicia já atualizado. Se ninguém clicar, instala ao fechar o app.
O portátil não se atualiza: mostra o aviso e abre a página do release. Os dados em `%APPDATA%\PainelWoods` ficam.
Precisa do GitHub CLI (`gh`) logado. Para testar sem publicar, rode `npm start` com `PAINEL_TESTAR_ATUALIZACAO=1` e um
`dev-app-update.yml` na raiz apontando para um servidor local (provider `generic`).

### Assinatura
O build funciona sem certificado. Para assinar, defina antes do `npm run dist` as variáveis que o electron-builder lê:
```
set CSC_LINK=C:\caminho\certificado.pfx
set CSC_KEY_PASSWORD=senha-do-certificado
```
Não coloque o certificado nem a senha no repositório.

## Vários computadores
O mesmo trabalho no PC de casa e nos notebooks, como se fosse um computador só. Detalhes e casos de conflito:
[docs/sincronia.md](docs/sincronia.md).

- **Pasta do WOODS** (leads, sites, fichas, prints, inclusive o que ainda não tem commit): vai e volta pelo GitHub
  numa referência própria (`refs/painel/espelho`), que não é branch. O `main` só muda com o push do lead aprovado, como antes.
- **Conversas, sessões do Claude, preferências e travas**: pelo Woods Web (Supabase). Conecte a mesma conta nos três.
- **Um lead, um computador**: enquanto o Claude trabalha num lead, os outros computadores não começam nele.
- Fica em cada computador: o login do GitHub, o login do Claude ou a chave da API, o navegador dos prints.

## Woods Web
Painel online e privado com todos os sites, para consultar do celular ou de outro computador sem o PC ligado,
e o caminho das conversas e preferências entre os computadores. O serviço `sincronia/` lê as fichas e os prints do
WOODS e envia os metadados, as conversas (compactadas, no bucket privado `conversas`) e as preferências ao Supabase.
Chaves e credenciais nunca saem do computador. Sem internet, os envios esperam numa fila e seguem quando a conexão volta.

- Configurar tudo (Supabase, conta, conexão do app): [docs/woods-web.md](docs/woods-web.md)
- Publicar o painel web no Cloudflare Pages: [docs/cloudflare-pages.md](docs/cloudflare-pages.md)
- No app: **Configurações** → cartão **Woods Web** → URL, chave pública, e-mail e senha → **Conectar**.

## Arquivos
- `main.js`: janela, protocolo `painel://`, ações que a página pode pedir e encerramento dos processos
- `preload.cjs`: a única ponte entre a página e o app (`pedir` e `ouvir`)
- `painel.js`: leads e conversa com o Claude (Agent SDK)
- `woods.js`: WOODS (clonar, instalar, atualizar), navegador e ferramentas embutidas
- `nucleo.js`: configuração, caminho seguro de arquivos e log
- `sincronia/`: tudo entre computadores e o Woods Web. `espelho.js` (pasta do WOODS pelo git), `servico.js` (Supabase:
  projetos, conversas, preferências, travas), `conversas.js`, `mapa.js`, `fila.js` (offline) e `supabase.js` (cliente)
- `supabase/migrations/`: tabelas, índices e políticas RLS do Woods Web
- `web/`: o Woods Web (React + Vite), publicado à parte no Cloudflare Pages
- `public/`: a página (`index.html`, `app.js`, `style.css`), `nuvem.js` (cartão do Woods Web) e `util.js` (funções usadas pelos dois lados)
- `scripts/ferramentas.js`: baixa o que vai em `vendor/`
- `build/`: ícone e a pergunta do desinstalador

## Segurança
- A página roda isolada (`contextIsolation`, `sandbox`, sem Node) e com CSP. Não há servidor HTTP nem porta aberta.
- A prévia dos sites dos leads fica em outra origem (`painel://site`) e não alcança as ações do painel.
- Chave da API cifrada pelo Windows; chaves e tokens são cortados do que vai para o log e para as conversas.
- Woods Web: o app usa só a chave pública do Supabase (recusa a service_role); a sessão fica cifrada pelo Windows e só no processo principal, nunca na página. A senha não é guardada.
- Uma instância só. Ao fechar, o app encerra o Claude, o Playwright e os processos que abriu.
