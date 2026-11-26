import APP_HTML from "./app.html";

const API = "https://api.abacatepay.com/v1";
const YEAR = 60 * 60 * 24 * 365;

/* ---------- utilidades ---------- */
const hex = (n = 32) =>
  [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

function safeEq(a = "", b = "") {
  const enc = new TextEncoder();
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

const kget = (env, k) => env.KV.get(k, "json");
const kput = (env, k, v, ttl) =>
  env.KV.put(k, JSON.stringify(v), ttl ? { expirationTtl: ttl } : undefined);

function html(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...extra,
    },
  });
}

const redirect = (to, extra = {}) =>
  new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store", ...extra } });

function cookieOf(req, name) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + name + "=([a-f0-9]+)"));
  return m ? m[1] : null;
}

const setCookie = (sid) =>
  `rs=${sid}; Path=/; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Lax`;

/* ---------- sessões e licenças ---------- */
// licença: { sessions:[sid,...], max }
async function newSession(env, licKey) {
  const max = Number(env.MAX_DEVICES || 2);
  const lic = (await kget(env, "lic:" + licKey)) || { sessions: [], max };
  const sid = hex(32);
  lic.sessions.push(sid);
  // passou do limite: derruba os aparelhos mais antigos
  while (lic.sessions.length > max) {
    const old = lic.sessions.shift();
    await env.KV.delete("sess:" + old);
  }
  await kput(env, "sess:" + sid, { lic: licKey }, YEAR);
  await kput(env, "lic:" + licKey, lic);
  return sid;
}

async function validSession(req, env) {
  const sid = cookieOf(req, "rs");
  if (!sid) return false;
  const s = await kget(env, "sess:" + sid);
  if (!s) return false;
  const lic = await kget(env, "lic:" + s.lic);
  return !!(lic && lic.sessions.includes(sid));
}

/* ---------- AbacatePay ---------- */
async function abacate(env, path, init = {}) {
  const r = await fetch(API + path, {
    ...init,
    headers: {
      authorization: "Bearer " + env.ABACATE_API_KEY,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error("abacatepay " + r.status + " " + JSON.stringify(j.error || ""));
  return j.data;
}

// Confere direto na API se a cobrança está paga (rede de segurança se o webhook atrasar).
async function isPaidOnApi(env, billingId) {
  try {
    const list = await abacate(env, "/billing/list");
    const b = (Array.isArray(list) ? list : []).find((x) => x.id === billingId);
    return !!b && String(b.status).toUpperCase() === "PAID";
  } catch {
    return false;
  }
}

/* ---------- páginas ---------- */
const CSS = `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c1714;color:#f2f7f3;font:16px/1.55 system-ui,sans-serif;padding:20px}
.c{max-width:460px;width:100%;background:#14251f;border:1px solid #294238;border-radius:22px;padding:28px}
h1{margin:0 0 8px;font-size:26px}p{color:#a9bcb1}button,input{font:inherit;width:100%;border-radius:12px;padding:13px;border:1px solid #294238;margin-top:10px}
button{background:#8de0ad;color:#10251b;font-weight:800;border:0;cursor:pointer}input{background:#0d1b16;color:#f2f7f3}
.k{font:700 18px ui-monospace,monospace;background:#0d1b16;border:1px dashed #8de0ad;border-radius:12px;padding:14px;word-break:break-all;text-align:center;color:#b8f2ca}
small{color:#a9bcb1;display:block;margin-top:14px}a{color:#8de0ad}</style>`;

const head = (t) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t}</title>${CSS}</head><body><div class="c">`;
const foot = `</div></body></html>`;

function landing(env, msg = "") {
  const price = (Number(env.PRICE_CENTS) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return html(`${head("Recomeço")}
<h1>Recomeço</h1><p>Um espaço de apoio, metas, diário e jogos para atravessar um dia de cada vez.</p>
${msg ? `<p style="color:#ffd0d0">${msg}</p>` : ""}
<form method="POST" action="/checkout"><button>Quero acesso — ${price} (pagamento único)</button></form>
<form method="POST" action="/entrar"><input name="code" placeholder="Já comprei: digite seu código de acesso" autocomplete="off"><button style="background:#263e34;color:#f2f7f3;border:1px solid #294238">Entrar</button></form>
<small>Seus registros ficam salvos só no aparelho em que você usa. Ao entrar em outro aparelho, começa do zero.</small>
<script>try{var o=localStorage.getItem('recomeco_order');if(o){var a=document.createElement('a');a.href='/ativar?o='+o;a.textContent='Já paguei e não fui liberado(a)? Clique aqui.';var s=document.createElement('small');s.append(a);document.querySelector('.c').append(s)}}catch(e){}</script>
${foot}`);
}

/* ---------- rotas ---------- */
async function checkout(req, env, url) {
  const order = hex(24);
  const data = await abacate(env, "/billing/create", {
    method: "POST",
    body: JSON.stringify({
      frequency: "ONE_TIME",
      methods: ["PIX"],
      products: [
        { externalId: "recomeco-acesso", name: env.PRODUCT_NAME || "Recomeço", quantity: 1, price: Number(env.PRICE_CENTS) },
      ],
      returnUrl: url.origin + "/",
      completionUrl: url.origin + "/ativar?o=" + order,
    }),
  });
  await kput(env, "order:" + order, { billingId: data.id, used: false }, 60 * 60 * 24 * 30);
  // guarda o pedido no navegador (permite retomar se a pessoa fechar a aba após pagar)
  return html(
    `<!doctype html><meta charset="utf-8"><script>try{localStorage.setItem('recomeco_order',${JSON.stringify(order)})}catch(e){}location.replace(${JSON.stringify(data.url)})</script>`
  );
}

async function webhook(req, env, url) {
  if (!safeEq(url.searchParams.get("webhookSecret") || "", env.WEBHOOK_SECRET || "")) {
    return new Response("unauthorized", { status: 401 });
  }
  const ev = await req.json().catch(() => null);
  if (!ev) return new Response("bad request", { status: 400 });
  if (ev.devMode === true && env.ALLOW_DEV !== "1") return new Response("ignored", { status: 200 });
  if (ev.event !== "billing.paid") return new Response("ok", { status: 200 });

  const b = ev.data?.billing || ev.data?.checkout || ev.data || {};
  const id = b.id;
  if (!id) return new Response("ok", { status: 200 });
  if (typeof b.amount === "number" && b.amount < Number(env.PRICE_CENTS)) return new Response("ignored", { status: 200 });

  await kput(env, "paid:" + id, { at: Date.now() }, 60 * 60 * 24 * 365 * 5);
  return new Response("ok", { status: 200 });
}

async function ativar(req, env, url) {
  const o = (url.searchParams.get("o") || "").replace(/[^a-f0-9]/g, "");
  const order = o && (await kget(env, "order:" + o));
  if (!order) return landing(env, "Link inválido ou expirado.");

  const paid = (await kget(env, "paid:" + order.billingId)) || (await isPaidOnApi(env, order.billingId));
  if (!paid) {
    return html(`${head("Aguardando pagamento")}<h1>Aguardando o pagamento…</h1><p>Assim que o Pix for confirmado, o acesso é liberado automaticamente. Esta página atualiza sozinha.</p>
<script>setTimeout(function(){location.reload()},4000)</script>${foot}`);
  }

  // Licença do pedido (criada uma vez). A página de ativação é reaproveitável só no mesmo navegador.
  if (!order.lic) {
    order.lic = hex(10).toUpperCase().match(/.{1,5}/g).join("-"); // ex: 3F9A1-C20BD-7E41A-955C3
    await kput(env, "order:" + o, order, 60 * 60 * 24 * 30);
    await kput(env, "lic:" + order.lic, { sessions: [], max: Number(env.MAX_DEVICES || 2) });
  } else if (!order.used) {
    // ok: primeira ativação ainda em andamento
  } else if (!(await validSession(req, env))) {
    // pedido já ativado e esta pessoa não tem sessão válida: link copiado -> não entra
    return landing(env, "Este link de ativação já foi usado. Use seu código de acesso para entrar.");
  }

  const sid = await newSession(env, order.lic);
  order.used = true;
  await kput(env, "order:" + o, order, 60 * 60 * 24 * 30);

  return html(
    `${head("Acesso liberado")}<h1>Pagamento confirmado ✅</h1><p>Guarde seu código de acesso. Ele serve para entrar em outro aparelho (limite de ${Number(env.MAX_DEVICES || 2)} aparelhos).</p>
<div class="k">${order.lic}</div><small>Não compartilhe: quem tiver o código pode usar seu acesso.</small>
<form method="GET" action="/app"><button>Abrir o Recomeço</button></form>${foot}`,
    200,
    { "set-cookie": setCookie(sid) }
  );
}

async function entrar(req, env) {
  const form = await req.formData().catch(() => null);
  const code = String(form?.get("code") || "").toUpperCase().replace(/[^A-F0-9-]/g, "");
  const lic = code && (await kget(env, "lic:" + code));
  if (!lic) return landing(env, "Código não encontrado.");
  const sid = await newSession(env, code);
  return redirect("/app", { "set-cookie": setCookie(sid) });
}

async function app(req, env) {
  if (!(await validSession(req, env))) return redirect("/");
  return html(APP_HTML, 200, { "cache-control": "private, no-store" });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/" && req.method === "GET") return landing(env);
      if (url.pathname === "/checkout" && req.method === "POST") return await checkout(req, env, url);
      if (url.pathname === "/webhook/abacatepay" && req.method === "POST") return await webhook(req, env, url);
      if (url.pathname === "/ativar" && req.method === "GET") return await ativar(req, env, url);
      if (url.pathname === "/entrar" && req.method === "POST") return await entrar(req, env);
      if (url.pathname === "/app" && req.method === "GET") return await app(req, env);
      return new Response("Not found", { status: 404 });
    } catch (e) {
      return landing(env, "Erro temporário. Tente novamente em instantes.");
    }
  },
};
