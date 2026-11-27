/* Service worker do Recomeçar: existe para o app poder ser instalado.
   NÃO guarda nada em cache (os dados são pessoais): só mostra um aviso se estiver sem internet. */
const OFFLINE = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sem conexão</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0c1714;color:#f2f7f3;font:16px system-ui,sans-serif;text-align:center;padding:24px"><div><div style="font-size:44px">🌱</div><h1 style="font-size:22px">Sem conexão</h1><p style="color:#a9bcb1">O Recomeçar precisa de internet para abrir seus dados. Conecte-se e tente de novo.</p><button onclick="location.reload()" style="border:0;border-radius:12px;padding:12px 22px;background:#8de0ad;color:#10251b;font-weight:800;font-size:16px">Tentar de novo</button></div></body></html>';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
  }
});
