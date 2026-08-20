# Shannon Casino

Projeto web com autenticação pelo Supabase, carteira compartilhada e os jogos Slot e Mines.

## Estrutura

```text
tigrinho-claude/
├── claudeshannon.html       # página principal
├── assets/
│   ├── audio/               # áudios do site
│   ├── css/                 # estilo da página principal
│   ├── fonts/               # fontes locais
│   ├── img/                 # imagens do site
│   └── js/                  # autenticação, carteira e interface
│       └── vendor/          # bibliotecas de terceiros
├── mines/                   # jogo Mines
├── slot/                    # jogo Slot
├── supabase/                # banco, configuração e Edge Functions
├── BANCO-DE-DADOS.md        # configuração do Supabase
├── package.json             # dependências de desenvolvimento
└── package-lock.json        # versões instaladas
```

## Executar o site

Abra `claudeshannon.html` com o Live Server. Não use um endereço iniciado por `file:///`, porque autenticação, iframes e requisições ao Supabase precisam de um servidor HTTP local.

## Configurar o Supabase

Siga o passo a passo em [`BANCO-DE-DADOS.md`](./BANCO-DE-DADOS.md). A Project URL e a Publishable key ficam em [`assets/js/supabase-client.js`](./assets/js/supabase-client.js).

Nunca coloque uma Secret key, uma chave `service_role` ou a senha do banco nos arquivos do navegador.
