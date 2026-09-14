# Sorteio do Açougue

App de sorteio com pagamento via Pix, conectado ao Supabase.

## Rodar localmente

1. Instale as dependências:
   ```
   npm install
   ```
2. Inicie o servidor de desenvolvimento:
   ```
   npm run dev
   ```
3. Abra o endereço que aparecer no terminal (geralmente http://localhost:5173).

As credenciais do Supabase já estão preenchidas em `src/App.jsx`, nas constantes
`SUPABASE_URL` e `SUPABASE_ANON_KEY`. Se você trocar de projeto no Supabase, atualize
esses dois valores lá.

## Publicar de graça (Vercel)

1. Crie uma conta em vercel.com (pode entrar com GitHub).
2. Suba esta pasta para um repositório no GitHub (ou use `vercel` pelo terminal, veja abaixo).
3. Na Vercel, clique em "Add New Project", selecione o repositório, e clique em "Deploy".
   A Vercel detecta automaticamente que é um projeto Vite — não precisa configurar nada.
4. Em alguns minutos você recebe um link público (tipo `seu-app.vercel.app`) que pode
   compartilhar com o açougue e os clientes.

### Alternativa sem GitHub (linha de comando)

```
npm install -g vercel
vercel
```

Siga as perguntas no terminal (login, nome do projeto) e ele já publica.

## Publicar de graça (Netlify)

1. Rode `npm run build` — isso cria uma pasta `dist/`.
2. Vá em app.netlify.com, arraste a pasta `dist/` pra área de deploy manual.
3. Pronto, você recebe um link público.

## Estrutura do projeto

- `src/App.jsx` — todo o app (área do cliente + painel do açougue).
- `src/main.jsx` — ponto de entrada do React.
- `index.html` — página HTML base.

## Segurança

A chave usada no app é a `anon`/`publishable` do Supabase — ela é segura para expor
publicamente, desde que as políticas de RLS (Row Level Security) estejam configuradas
como no script SQL que criamos juntos. Nunca use a chave `secret`/`service_role` neste
arquivo.
