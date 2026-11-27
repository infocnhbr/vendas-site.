/* Recomeço — acesso por CPF no Cloudflare Workers
   Banco de dados: Workers KV (binding "DB")  |  Arquivos: pasta public/ (binding "ASSETS") */

const SESSAO_S = 12 * 60 * 60;            // sessão de 12 horas
const enc = new TextEncoder();
let segredoCache = null;

/* ---------- utilidades ---------- */
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
const b64u = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
function igual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function segredo(env) {
  if (env.SEGREDO) return env.SEGREDO;
  if (segredoCache) return segredoCache;
  let s = await env.DB.get('segredo');
  if (!s) {
    s = hex(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.put('segredo', s);
  }
  segredoCache = s;
  return s;
}
async function hmac(env, tag, v) {
  const k = await crypto.subtle.importKey('raw', enc.encode(await segredo(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(tag + '|' + v))));
}

/* ---------- CPF ---------- */
const soDig = v => String(v || '').replace(/\D/g, '');
function cpfValido(v) {
  const c = soDig(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += parseInt(c[i], 10) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== parseInt(c[t], 10)) return false;
  }
  return true;
}
const cpfMask = c => { c = soDig(c); return '***.' + c.slice(3, 6) + '.' + c.slice(6, 9) + '-**'; };

/* ---------- sessão (cookie assinado) ---------- */
async function criarCookie(env, u) {
  const p = b64u(JSON.stringify({ u, exp: Math.floor(Date.now() / 1000) + SESSAO_S }));
  const t = p + '.' + await hmac(env, 'sessao', p);
  return 'rc_sessao=' + t + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + SESSAO_S;
}
function lerCookie(request, nome) {
  for (const x of (request.headers.get('Cookie') || '').split(';')) {
    const i = x.indexOf('=');
    if (i > 0 && x.slice(0, i).trim() === nome) return x.slice(i + 1).trim();
  }
  return null;
}
async function sessaoValida(env, request) {
  const t = lerCookie(request, 'rc_sessao');
  if (!t || t.indexOf('.') < 0) return false;
  const [p, sig] = t.split('.');
  try {
    if (!igual(sig || '', await hmac(env, 'sessao', p))) return false;
    const d = JSON.parse(unb64u(p));
    return !!d.exp && d.exp > Date.now() / 1000;
  } catch (e) { return false; }
}

/* ---------- limite de tentativas (por instância; reforce com Rate Limiting do Cloudflare) ---------- */
const hits = new Map(), trava = new Map();
function limite(ip, chave, max, janela) {
  const k = chave + '|' + ip, agora = Date.now();
  const a = (hits.get(k) || []).filter(t => agora - t < janela);
  a.push(agora); hits.set(k, a);
  if (hits.size > 5000) hits.clear();
  return a.length <= max;
}
function travado(ip) { const t = trava.get(ip); return t && t.ate > Date.now() ? Math.ceil((t.ate - Date.now()) / 1000) : 0; }
function falhou(ip) {
  const t = trava.get(ip) || { n: 0, ate: 0 };
  t.n++;
  if (t.n >= 5) { t.n = 0; t.ate = Date.now() + 60000; }
  trava.set(ip, t);
}

/* ---------- respostas ---------- */
const BASE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function json(obj, status = 200, cookie) {
  const h = new Headers({ ...BASE, 'Content-Type': 'application/json; charset=utf-8' });
  if (cookie) h.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(obj), { status, headers: h });
}
async function pagina(env, request, nome, status = 200) {
  const r = await env.ASSETS.fetch(new Request(new URL('/' + nome, request.url)));
  if (!r.ok) return new Response('Erro ao abrir a página.', { status: 500, headers: BASE });
  return new Response(r.body, { status, headers: { ...BASE, 'Content-Type': 'text/html; charset=utf-8' } });
}

/* ---------- rotas ---------- */
export default {
  async fetch(request, env) {
    try {
      return await tratar(request, env);
    } catch (e) {
      return json({ erro: 'Erro interno no servidor: ' + (e && e.message ? e.message : e) }, 500);
    }
  }
};

async function tratar(request, env) {
  {
    const url = new URL(request.url);
    const rota = url.pathname;
    const ip = request.headers.get('CF-Connecting-IP') || '?';
    const codigoAcesso = String(env.CODIGO_ACESSO || '');

    if (request.method === 'GET' || request.method === 'HEAD') {
      if (rota === '/') return Response.redirect(new URL('/acesso.html', request.url).toString(), 302);
      if (rota === '/acesso.html') return pagina(env, request, 'acesso.html');
      if (rota === '/recomeco.html') {
        if (await sessaoValida(env, request)) return pagina(env, request, 'recomeco.html');
        return pagina(env, request, 'bloqueado.html', 401);
      }
      if (rota === '/api/config') return json({ codigo: !!codigoAcesso });
      return new Response('Não encontrado.', { status: 404, headers: BASE });
    }

    if (request.method === 'POST' && rota.startsWith('/api/')) {
      if (!env.DB) return json({ erro: 'O banco de dados (KV "DB") não está conectado ao Worker. Veja o LEIA-ME, passo 4.' }, 500);
      if (!limite(ip, 'api', 40, 60000)) return json({ erro: 'Muitas requisições. Aguarde um instante.' }, 429);
      let b;
      try { b = await request.json(); } catch (e) { return json({ erro: 'Requisição inválida.' }, 400); }
      if (!b || typeof b !== 'object') return json({ erro: 'Requisição inválida.' }, 400);

      /* o dispositivo já está cadastrado? se sim, libera sem pedir CPF */
      if (rota === '/api/dispositivo') {
        const id = String(b.deviceId || '');
        if (id.length < 8 || id.length > 100) return json({ erro: 'Dispositivo inválido.' }, 400);
        const u = await env.DB.get('d:' + await hmac(env, 'dev', id));
        if (!u) return json({ cadastrado: false });
        return json({ cadastrado: true }, 200, await criarCookie(env, u));
      }

      /* cadastra o CPF e liga este dispositivo a ele */
      if (rota === '/api/cadastrar') {
        const w = travado(ip);
        if (w) return json({ erro: 'Muitas tentativas. Aguarde ' + w + 's.' }, 429);
        if (!limite(ip, 'cad', 10, 60000)) return json({ erro: 'Muitas tentativas. Aguarde um instante.' }, 429);
        const id = String(b.deviceId || '');
        if (id.length < 8 || id.length > 100) return json({ erro: 'Dispositivo inválido.' }, 400);
        if (codigoAcesso && String(b.codigo || '') !== codigoAcesso) { falhou(ip); return json({ erro: 'Código de acesso incorreto.' }, 403); }
        if (!cpfValido(b.cpf)) return json({ erro: 'CPF inválido. Confira os números.' }, 400);
        const k = await hmac(env, 'cpf', soDig(b.cpf)), dh = await hmac(env, 'dev', id);
        const agora = new Date().toISOString();
        let u = null;
        try { u = JSON.parse(await env.DB.get('u:' + k) || 'null'); } catch (e) {}
        if (!u) u = { cpf: cpfMask(b.cpf), criadoEm: agora, dispositivos: [] };
        if (!u.dispositivos.includes(dh)) u.dispositivos.push(dh);
        u.ultimoAcesso = agora;
        await env.DB.put('u:' + k, JSON.stringify(u));
        await env.DB.put('d:' + dh, k);
        return json({ ok: true }, 200, await criarCookie(env, k));
      }

      /* entra só com CPF (quem abriu o recomeco direto) — precisa já estar cadastrado */
      if (rota === '/api/entrar') {
        const w = travado(ip);
        if (w) return json({ erro: 'Muitas tentativas. Aguarde ' + w + 's.' }, 429);
        if (!limite(ip, 'ent', 10, 60000)) return json({ erro: 'Muitas tentativas. Aguarde um instante.' }, 429);
        if (!cpfValido(b.cpf)) return json({ erro: 'CPF inválido. Confira os números.' }, 400);
        const k = await hmac(env, 'cpf', soDig(b.cpf));
        if (!(await env.DB.get('u:' + k))) { falhou(ip); return json({ erro: 'CPF não cadastrado. O acesso não está liberado.' }, 404); }
        trava.delete(ip);
        return json({ ok: true }, 200, await criarCookie(env, k));
      }
    }

    return new Response('Não encontrado.', { status: 404, headers: BASE });
  }
}
