# Passo a passo manual

## Parte 1: deixar o Painel Woods funcionando hoje (até 00:30)

O Woods Web é opcional. Enquanto você não conectar uma conta, o app funciona exatamente como antes.
**Não faça a Parte 2 hoje se o prazo apertar**: ela não é necessária para o app funcionar.

1. **Espere o instalador novo ficar pronto** (previsão: 23:55). Ele está pronto quando os dois arquivos abaixo
   tiverem horário depois de 23:31:
   - `dist\Painel-Woods-Setup-1.0.0.exe`
   - `dist\Painel-Woods-1.0.0-portable.exe`
2. **Feche o Painel Woods**, se estiver aberto. Se houver um lead com o Claude trabalhando, espere terminar ou clique em **Parar**.
3. **Dê dois cliques em `dist\Painel-Woods-Setup-1.0.0.exe`**. Se aparecer "O Windows protegeu o computador":
   **Mais informações** → **Executar assim mesmo**. A instalação substitui a versão antiga; leads, conversas,
   configurações e login ficam (estão em `%APPDATA%\PainelWoods`).
4. **Abra o Painel Woods** e confira (2 minutos):
   - [ ] A lista de leads aparece.
   - [ ] Abrir um lead mostra a prévia A/B e os prints.
   - [ ] Em **Configurações**, os passos 1 a 5 estão "pronto" e há um cartão novo **Woods Web (opcional)**, "desligado".
5. **Se algo não funcionar**: feche o app e use a versão anterior, que guardei em
   `reserva\Painel-Woods-1.0.0-portable-ANTERIOR.exe` (dois cliques, não precisa instalar; usa os mesmos dados).

## Parte 2: colocar o Woods Web online (depois, com calma; ~30 min)

Detalhes e prints de tela em [woods-web.md](woods-web.md) e [cloudflare-pages.md](cloudflare-pages.md).

### A. Subir o código para o GitHub
Peça ao Claude para fazer o commit e o push no `rodrgo07/Painel-Woods`, ou faça você mesmo.

### B. Supabase (banco, login e imagens)
1. <https://supabase.com> → criar conta → **New project**: nome `woods-web`, região **São Paulo**, plano **Free**.
   Guarde a senha do banco num gerenciador de senhas.
2. **SQL Editor** → **New query** → cole todo o arquivo `supabase/migrations/20261115000000_woods_web.sql` → **Run**.
   Deve aparecer "Success". Numa query nova, faça o mesmo com `supabase/migrations/20261116000000_equipe.sql`.
   (Já tinha rodado o primeiro antes? Rode só o segundo.)
3. **Authentication** → **Users** → **Add user** → **Create new user**: seu e-mail, senha forte, marque **Auto Confirm User**.
   Repita com o e-mail do sócio. Depois, no **SQL Editor**:
   `select public.adicionar_membro('seu@email.com', 'R Host');` e `select public.adicionar_membro('email.do.socio@email.com', 'L Host');`
4. **Authentication** → **Sign In / Providers** → desligue **Allow new users to sign up** → salvar.
5. **Project Settings** → **API Keys**: anote a **Project URL** e a chave **anon** (`eyJ…`) ou **publishable**
   (`sb_publishable_…`). **Nunca** use a `service_role` nem a `sb_secret_…`.

### C. Cloudflare Pages (o site do painel)
1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → repositório **Painel-Woods**.
2. Configuração:
   - Production branch: `main`
   - Root directory: `web`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Variáveis: `VITE_SUPABASE_URL` = Project URL · `VITE_SUPABASE_ANON_KEY` = chave pública · `NODE_VERSION` = `22`
3. **Save and Deploy**. Anote o endereço (`https://woods-web….pages.dev`).
4. De volta ao Supabase: **Authentication** → **URL Configuration** → **Site URL** = esse endereço.

### D. Conectar o Painel Woods
Painel Woods → **Configurações** → cartão **Woods Web** → URL, chave pública, e-mail e senha → **Conectar**.
No PC do sócio, o mesmo, com a conta dele.
Em até 1 minuto os leads aparecem no endereço do Cloudflare.

### E. Conferir
- [ ] Endereço do Cloudflare numa janela anônima mostra só o login.
- [ ] Entrando, a visão geral mostra os leads dos dois e "Desktop conectado".
- [ ] Com a conta do sócio, aparecem os mesmos leads, e em Sites o botão **Meus leads** filtra os dele.
- [ ] O detalhe de um lead mostra os prints.
- [ ] No celular, o mesmo endereço funciona.

## Depois, no dia a dia
- Nada muda no uso do Painel Woods. Com o app aberto, ele sincroniza sozinho a cada minuto.
- Sem internet, os envios esperam e seguem quando a conexão volta (cartão Woods Web mostra os pendentes).
- Se o Supabase avisar que o projeto foi **pausado** (7 dias sem uso no plano grátis): clique em **Restore**.
- Trocou a senha do Woods Web? Conecte o app de novo (o cartão mostra "sessão expirada").
- Não use o Woods Web para publicar sites de clientes: eles continuam pelo fluxo do WOODS.
