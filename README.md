# Painel Woods

Interface local para o repositório WOODS. Você cadastra o lead (nome + Instagram) e o Claude segue o
`vault/00-sistema/fluxo-novo-lead.md` do WOODS: pesquisa no Google e no Instagram, preenche o
`site.config.json`, cria as variantes A e B, faz SEO e gera os 4 prints. Tudo aparece no painel:
a prévia de A e B (celular e desktop), os prints, a ficha e a conversa com o Claude.

O Claude roda por baixo pelo Claude Agent SDK, que é o próprio Claude Code. Ele trabalha dentro da
pasta do WOODS, com o `CLAUDE.md` e as regras de lá. O painel não copia nada do WOODS: lê e escreve
direto no repositório.

## Primeira vez
```
npm install
```
Login do Claude (uma vez só; usa sua assinatura do Claude):
```
& .\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe auth login
```
No cmd: `"node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe" auth login`.
Sem login, uma chave da API (cobrada por uso) também serve: copie `.env.exemplo` para `.env` e preencha `ANTHROPIC_API_KEY`.

## Usar
Dê dois cliques no `Woods.exe`: ele liga o servidor escondido e abre o painel numa janela própria (Edge em modo app).
Fechar a janela desliga o servidor e para o Claude, se ele estiver trabalhando.
O `Woods.exe` precisa ficar nesta pasta e usa o Node.js instalado. Para gerar de novo depois de mudar `app/Woods.cs`:
```
powershell -ExecutionPolicy Bypass -File app\gerar.ps1
```
Sem o exe: `npm start` e abra http://localhost:4300.

- **Novo lead**: nome, Instagram, cidade e responsável. O painel roda o `npm run novo-lead` e o Claude segue o fluxo até os prints.
- **Logins e captcha**: o Playwright abre uma janela do navegador (Chrome; sem ele, Edge). Quando o Claude pedir, faça o login do Instagram ou do Cloudflare nessa janela e responda "feito" no painel.
- **Permissões**: comandos fora da lista liberada (veja `PERMITIDAS` em `servidor.js`) aparecem como um cartão com Permitir, Sempre ou Negar. O `git push` sempre pede permissão.
- **Ajustes**: escreva no campo da conversa ("troque a cor do botão da B", "use outra foto no hero").
- **Aprovar e publicar**: o botão aparece quando a ficha está em `site pronto`; o Claude segue as etapas 7 e 8.
- **Parar**: interrompe o Claude na hora.

Um lead por vez: o navegador do Playwright é um só. Cada lead tem sua própria sessão do Claude
(`dados/sessoes.json`), então dá para voltar a um lead dias depois e continuar a conversa.

## Configuração (`.env`, opcional)
| Variável | Padrão |
|---|---|
| `WOODS_DIR` | `Documentos\WOODS` |
| `PORTA` | `4300` |
| `CLAUDE_MODELO` | `claude-opus-5-5` |
| `ANTHROPIC_API_KEY` | vazio (usa o login do Claude Code) |

## Arquivos
- `servidor.js`: API, prévia dos sites e sessões do Claude
- `public/`: a página (`index.html`, `app.js`, `style.css`) e `util.js` (funções usadas pelos dois lados)
- `dados/`: conversa de cada lead (`<slug>.jsonl`) e sessões. Não vai para o git
- `npm run teste`: testes de `util.js`

O servidor só aceita conexões deste computador (o Claude roda comandos aqui).
