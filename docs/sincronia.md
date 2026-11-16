# Sincronização entre computadores

O Painel Woods roda no PC de casa e em dois notebooks. A sincronização faz os três funcionarem como um computador só:
um lead criado em casa aparece no notebook com a pasta, a ficha, os sites, os prints e a conversa com o Claude, e o
Claude continua de onde parou.

## O que vai por onde

| O quê | Por onde | Quando |
|---|---|---|
| Pasta do WOODS inteira: fichas, `sites/<slug>/` (A, B, fotos, prints, `site.config.json`), vault, tudo que ainda não tem commit e os commits locais | GitHub, referência `refs/painel/espelho` (não é branch) | A cada minuto, ao abrir o app, ao acordar o PC, quando o Claude termina e antes de o Claude começar |
| Histórico do painel (`conversas/<slug>.jsonl`) e sessão do Claude Code de cada lead | Supabase, tabela `conversas` + bucket privado `conversas` (`.gz`) | Igual |
| Modelo, nome e e-mail dos commits, permissões "Sempre" (`WOODS/.claude/settings.local.json`) | Supabase, tabela `preferencias` | Igual |
| Qual computador está com o Claude em cada lead | Supabase, tabela `travas` | Quando o Claude começa e termina (renovada a cada 2 min) |
| `dist/` dos sites | Não vai: cada computador refaz com `npm run build -- <slug>` quando chega um lead mudado | Logo depois da sincronização |
| `node_modules` | Não vai: `npm ci` roda sozinho quando o `package-lock.json` muda | Logo depois da sincronização |
| Login do GitHub, login do Claude, chave da API, navegador dos prints | Fica em cada computador (o cofre do Windows só abre a chave no computador que a gravou) | Configure uma vez em cada um |

### Por que uma referência e não um branch
No WOODS, cada push no `main` publica o lead no Cloudflare, e o Cloudflare também gera prévias a cada push em
qualquer branch. A foto da pasta vai para `refs/painel/espelho`, que o Cloudflare não enxerga. O `main` só muda quando
o Claude faz o push do lead aprovado, exatamente como antes.

Se o GitHub recusar essa referência, o app passa sozinho a usar o branch `painel-espelho` e registra isso no log.
Nesse caso, desligue as prévias desse branch em cada projeto do Cloudflare: **Settings → Builds → Branch control →
Preview branch: Custom branches → Exclude: `painel-espelho`**.

## Como funciona
- **Foto da pasta**: commit cuja árvore é a pasta do WOODS como ela está (respeitando o `.gitignore`) e cujo primeiro pai é
  o HEAD daquele computador. A referência só anda para frente: um push atrasado é recusado e tenta de novo, nunca apaga
  o trabalho de outro computador.
- **Chegou algo de outro computador**: a pasta é atualizada para ficar igual. Se os dois mexeram em arquivos diferentes,
  junta os dois (merge de 3 vias) antes de tocar em qualquer arquivo.
- **Conversas**: cada envio leva um número de versão e só vale se ninguém mandou outra antes. Se dois computadores
  conversaram sem internet, os históricos do painel se somam em ordem de tempo; a sessão do Claude que vale é a da nuvem,
  e a do outro fica guardada ao lado (`<sessão>.conflito-<data>.jsonl.bak`, na pasta do Claude Code).
- **Caminho do WOODS**: a sessão do Claude tem o caminho da pasta dentro (`C:\Users\<você>\AppData\…`). Ele é trocado por
  `{{WOODS}}` na nuvem e volta com o caminho do computador que baixou.
- **Trava**: antes de o Claude começar, o app traz o WOODS e a conversa mais novos e trava o lead. Se outro computador
  está com o Claude nele, o painel avisa e não começa. Trava sem renovação por 10 minutos (PC desligado no meio) vence sozinha.
- **Woods Web**: um computador com o WOODS atrasado não envia os projetos até sincronizar, e o banco recusa sobrescrever um
  projeto com uma ficha mais velha (gatilho `projetos_mais_novo`). Eventos (mudança de status etc.) são registrados só pelo
  computador onde a mudança aconteceu.

## Conflito
Acontece quando o **mesmo arquivo** mudou em dois computadores antes de eles se falarem (por exemplo, os dois sem internet),
ou quando há commits diferentes nos dois. Nada é alterado. O aviso aparece no topo do painel e em
**Configurações → Sincronização entre computadores**, com a lista de arquivos:

- **Ficar com a deste computador**: a versão daqui vale para todos.
- **Ficar com a do outro computador**: a daqui é substituída e guardada em `refs/painel/backup/<data>` no git deste computador.

Nos dois casos a outra versão continua no histórico do git e dá para recuperar. Enquanto o conflito envolver um lead,
o Claude não começa nesse lead.

## Colocar para funcionar (uma vez)
1. **Supabase**: rode `supabase/migrations/20261116000000_sincronia_total.sql` no SQL Editor (depois da migration do Woods Web).
2. **Instalador novo**: no PC de casa, `npm run dist` e instale `dist\Painel-Woods-Setup-<versão>.exe` nos três computadores.
3. **Em cada computador**: Configurações → passos 1 a 5 (GitHub, WOODS, Claude) e o cartão **Woods Web** com a **mesma conta**.
4. Comece pelo computador que tem o trabalho mais recente: abra o app e espere o cartão **Sincronização entre computadores**
   ficar "em dia". Depois abra os outros. Trabalho que só existia num notebook também vai junto (é juntado, não apagado).

## Limites
- O GitHub precisa estar acessível (login feito no passo 2). Sem internet, cada computador continua trabalhando e junta
  quando a conexão volta.
- Arquivos maiores que 100 MB não passam pelo GitHub (as fotos dos leads são bem menores).
- Uma sessão do Claude maior que 50 MB compactada não sobe (limite do plano gratuito do Supabase); o histórico do painel sobe mesmo assim.
