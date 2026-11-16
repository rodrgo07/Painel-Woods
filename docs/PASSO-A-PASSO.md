# Passo a passo: instalar a versão 1.2.0

A 1.2.0 junta tudo o que estava em branches separadas: atualização automática do app, escolher um elemento da
prévia, modo equipe com o sócio e os computadores sincronizados como um só. O banco e o app mudam **no mesmo dia**:
a migration de integração troca a chave dos projetos, e a versão antiga do app para de sincronizar depois dela.

Ordem: **1** testar num Supabase de teste → **2** banco de produção → **3** instalar nos quatro computadores (logo depois do 2) →
**4** Woods Web → **5** arrumar. Detalhes do Supabase em [woods-web.md](woods-web.md) e da sincronização em
[sincronia.md](sincronia.md).

## 1. Testar sem tocar no que está funcionando

O plano grátis do Supabase permite dois projetos ativos, então dá para ter um de teste.

1. Supabase → **New project** `woods-web-teste`. No **SQL Editor**, rode em ordem (cada um numa query nova):
   `20261115000000_woods_web.sql`, `20261116000000_sincronia_total.sql`, `20261117000000_integracao.sql`.
2. Crie uma conta de teste (**Authentication → Users → Add user**, com **Auto Confirm User**) e rode
   `select public.adicionar_membro('<e-mail de teste>', 'R Host');`.
3. No PC de casa, na pasta do Painel-Woods: `npm test` (tudo verde) e `npm start` com um `.env` que aponte
   `PAINEL_DADOS` para uma pasta de teste. Conecte o cartão **Woods Web** no projeto de teste.
4. Crie um lead de teste com Responsável **R Host** e confira que ele aparece no Woods Web de teste com os prints.
5. Se der, repita num notebook com a mesma conta de teste: o lead e a conversa precisam aparecer lá.
6. Tudo certo: faça o merge do pull request `integracao` no `main`.

## 2. Banco de produção (no dia da instalação)

1. **Feche o Painel Woods em todos os computadores**, com nenhum lead rodando.
2. Supabase (projeto **Woods Web**) → **SQL Editor** → cole `supabase/migrations/20261117000000_integracao.sql` → **Run**.
   Só esse arquivo: os outros dois já estão aplicados.
3. **Authentication → Users → Add user**: crie a conta do sócio com **Auto Confirm User**.
4. No **SQL Editor**, ponha os dois na equipe com o nome igual ao do **Responsável** nas fichas:
   ```sql
   select public.adicionar_membro('seu@email.com', 'R Host');
   select public.adicionar_membro('email.do.socio@email.com', 'L Host');
   ```
5. **Authentication → Sign In / Providers**: confira que **Allow new users to sign up** está desligado.
6. O aviso de "senha vazada" pode ser ignorado: essa proteção só existe no plano Pro. Use senhas fortes nas duas contas.

## 3. Instalar a 1.2.0

1. No PC de casa: `npm run lancar` (gera o instalador e cria o release `v1.2.0` como rascunho no GitHub; precisa do
   `gh` logado). Sem o `gh`: `npm run dist` e crie o release **v1.2.0** à mão em **GitHub → Releases**, anexando
   `dist\Painel-Woods-Setup-1.2.0.exe` e `dist\latest.yml`. Publique o release.
2. **PC de casa primeiro**: instale o `Painel-Woods-Setup-1.2.0.exe` (se o Windows avisar: **Mais informações →
   Executar assim mesmo**). Abra e espere o cartão **Sincronização entre computadores** ficar "em dia".
3. **Notebook 1**: instale, faça os passos 1 a 5 das Configurações e conecte o **Woods Web** com a mesma conta. Espere "em dia".
4. **Notebook 2**: o mesmo.
5. **PC do sócio**: instale e conecte o Woods Web com a conta dele.

Daqui em diante as versões novas chegam sozinhas: o app baixa em segundo plano e mostra "Versão x pronta" na barra lateral.

## 4. Woods Web no Cloudflare

1. Confira que a build do Cloudflare rodou sozinha depois do merge no `main` e terminou sem erro.
2. Abra o Woods Web e confira que aparecem os quatro computadores em **PCs da equipe**.

## 5. Arrumar

1. Apague as branches que já entraram: `app-electron`, `equipe-woods-web`, `sincronia-total`, `teste-push-claude` e `integracao`.
2. Apague o projeto `woods-web-teste` no Supabase, ou deixe pausado.

## Como saber que chegou a 100%

Com os quatro computadores ligados:

- [ ] Lead criado no PC de casa aparece no notebook em até 2 minutos, com ficha, sites, prints e a conversa.
- [ ] O Claude continua a conversa desse lead no notebook de onde parou.
- [ ] Com o Claude rodando num lead no PC de casa, o notebook não consegue começar nesse lead.
- [ ] No PC do sócio, um lead seu mostra **Não permitido** no chat (e um dele, no seu).
- [ ] O mesmo arquivo mudado em dois PCs sem internet gera o aviso de conflito e nada se perde.
- [ ] O `main` do WOODS só muda com o push de um lead aprovado (nenhum deploy novo no Cloudflare por causa do espelho).
- [ ] O sócio entra no Woods Web com a conta dele e vê os mesmos leads; **Meus leads** filtra os dele.
- [ ] O Woods Web numa janela anônima mostra só o login; funciona no celular.
- [ ] Ao publicar uma release 1.2.1 de teste, os quatro computadores recebem a atualização.

## Se algo der errado

- **O app 1.2.0 não sincroniza** ("O banco do Supabase está desatualizado" ou "não está em nenhuma equipe"): falta o
  passo 2 (migration ou `adicionar_membro`).
- **Um PC ficou com a versão antiga depois da migration**: ele não envia nada ao Woods Web até receber a 1.2.0.
  Instale por cima; os dados em `%APPDATA%\PainelWoods` ficam.
- **Chat "Não permitido" num lead seu**: o Responsável da ficha e o seu nome na equipe têm de ser iguais
  (`adicionar_membro` de novo com o nome certo).
