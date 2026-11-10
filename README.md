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
- **Atualizar WOODS** (Configurações): puxa as novidades do GitHub só avançando (`--ff-only`). Se bater com trabalho local de um lead, recusa e não altera nada. Ao abrir, o app só avisa se há novidades.

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
- `npm test`: slug, ficha, bloqueio de `../`, configuração, checagens do WOODS e atualização sem perder trabalho local.
- `.env` (opcional, veja `.env.exemplo`): só no `npm start`. O app instalado não lê `.env`.

### Gerar o instalador
```
npm run dist
```
Sai em `dist/`: `Painel-Woods-Setup-<versão>.exe` e `Painel-Woods-<versão>-portable.exe`. A versão vem do `package.json`.

### Assinatura
O build funciona sem certificado. Para assinar, defina antes do `npm run dist` as variáveis que o electron-builder lê:
```
set CSC_LINK=C:\caminho\certificado.pfx
set CSC_KEY_PASSWORD=senha-do-certificado
```
Não coloque o certificado nem a senha no repositório.

## Arquivos
- `main.js`: janela, protocolo `painel://`, ações que a página pode pedir e encerramento dos processos
- `preload.cjs`: a única ponte entre a página e o app (`pedir` e `ouvir`)
- `painel.js`: leads e conversa com o Claude (Agent SDK)
- `woods.js`: WOODS (clonar, instalar, atualizar), navegador e ferramentas embutidas
- `nucleo.js`: configuração, caminho seguro de arquivos e log
- `public/`: a página (`index.html`, `app.js`, `style.css`) e `util.js` (funções usadas pelos dois lados)
- `scripts/ferramentas.js`: baixa o que vai em `vendor/`
- `build/`: ícone e a pergunta do desinstalador

## Segurança
- A página roda isolada (`contextIsolation`, `sandbox`, sem Node) e com CSP. Não há servidor HTTP nem porta aberta.
- A prévia dos sites dos leads fica em outra origem (`painel://site`) e não alcança as ações do painel.
- Chave da API cifrada pelo Windows; chaves e tokens são cortados do que vai para o log e para as conversas.
- Uma instância só. Ao fechar, o app encerra o Claude, o Playwright e os processos que abriu.
