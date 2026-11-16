# Woods Web

Painel online e privado dos sites gerados pelo Painel Woods. React + TypeScript + Vite, CSS próprio,
Supabase (login, banco e imagens) e hospedagem estática no Cloudflare Pages.

- Instalação completa (Supabase, conta, desktop): [../docs/woods-web.md](../docs/woods-web.md)
- Publicação no Cloudflare Pages: [../docs/cloudflare-pages.md](../docs/cloudflare-pages.md)

```
npm install
npm run dev     # precisa de .env.local (veja .env.example)
npm test        # regras puras (src/lib/regras.ts)
npm run build   # confere tipos e gera dist/
```

| Pasta | Conteúdo |
|---|---|
| `src/lib/supabase.ts` | Cliente com a chave pública (recusa chave secreta) |
| `src/lib/dados.ts` | Consultas (RLS filtra pelo dono) e URLs assinadas das prévias |
| `src/lib/regras.ts` | Fases do status, filtros, integração, textos (testado em `teste/`) |
| `src/lib/ganchos.ts` | Atualização periódica (1 min, só com a aba visível) e rotas por `#` |
| `src/paginas/` | Login, Visão geral, Sites, Detalhe |
| `public/_headers` | Cabeçalhos de segurança do Cloudflare Pages |
