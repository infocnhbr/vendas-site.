# Recomeço — acesso protegido (Cloudflare Worker + AbacatePay)

## Deploy (uma vez só)

```bash
cd recomeco-worker
npm i -g wrangler            # ou use npx wrangler
npx wrangler login
npx wrangler kv namespace create KV     # copie o id para wrangler.toml
npx wrangler secret put ABACATE_API_KEY # chave da API do AbacatePay
npx wrangler secret put WEBHOOK_SECRET  # invente um texto longo e aleatório
npx wrangler deploy
```

## Configurar o webhook no AbacatePay

No painel, crie um webhook apontando para:

```
https://SEU-DOMINIO/webhook/abacatepay?webhookSecret=O_MESMO_WEBHOOK_SECRET
```

Evento: `billing.paid`. Depois, em Cloudflare > Workers > Settings > Domains, ligue seu domínio ao Worker.

## Testar antes de vender

1. Use a chave de **dev** do AbacatePay e coloque `ALLOW_DEV = "1"` em `[vars]`.
2. Faça uma compra, simule o pagamento (modo dev), confira que `/ativar` libera e `/app` abre.
3. Abra `/app` numa janela anônima: deve voltar para `/`.
4. **Remova `ALLOW_DEV` e troque para a chave de produção.**

## Proteção extra (recomendado, 2 minutos)

Cloudflare > Security > WAF > Rate limiting: limite `/entrar` e `/checkout` a ~10 requisições/min por IP.

## Ajustes

- Preço, nome e limite de aparelhos: `[vars]` em `wrangler.toml`.
- Para trocar a página inicial pela sua, edite a função `landing()` em `src/index.js`.
- Para atualizar o app, substitua `src/app.html` e rode `npx wrangler deploy`.
