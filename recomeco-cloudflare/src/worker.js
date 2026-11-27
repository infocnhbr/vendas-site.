/* Recomeço — acesso por CPF no Cloudflare Workers
   Banco de dados: Durable Object "Banco" (binding "BANCO", ver src/banco.js)  |  Arquivos: pasta public/ (binding "ASSETS")
   O KV antigo (binding "DB") é opcional: serve só para importar dados já existentes. */
export { Banco } from './banco.js';

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
  let s;
  if (typeof env.DB.segredo === 'function') s = await env.DB.segredo();
  else {                                       // só se o banco novo não estiver ligado (KV puro)
    s = await env.DB.get('segredo');
    if (!s) { s = hex(crypto.getRandomValues(new Uint8Array(32))); await env.DB.put('segredo', s); }
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
async function sessaoDados(env, request) {
  const t = lerCookie(request, 'rc_sessao');
  if (!t || t.indexOf('.') < 0) return null;
  const [p, sig] = t.split('.');
  try {
    if (!igual(sig || '', await hmac(env, 'sessao', p))) return null;
    const d = JSON.parse(unb64u(p));
    return d.exp && d.exp > Date.now() / 1000 ? d : null;
  } catch (e) { return null; }
}

/* ---------- perfil: dados do app (conquistas, contador, diário...) ligados ao CPF ----------
   u:<cpf>   -> { cpf, dispositivos, perfil }       (perfil ausente = perfil com o mesmo id do CPF)
   p:<perfil>-> { cpfs:[...], v, vApagado, dados }  (dados = null: nunca salvo | {} : apagado/vazio)
   Todos os CPFs ligados ao mesmo perfil enxergam os mesmos dados; apagar apaga para todos. */
const MAX_CHAVES = 40, MAX_VALOR = 300000, MAX_TOTAL = 1000000;
const chaveOk = k => /^recomeco_[a-z0-9_]{1,60}$/.test(k);
async function lerJSON(env, chave) { try { return JSON.parse(await env.DB.get(chave) || 'null'); } catch (e) { return null; } }
const perfilVazio = k => ({ cpfs: [k], v: 0, vApagado: 0, dados: null });

async function contexto(env, request) {
  const d = await sessaoDados(env, request);
  if (!d || !d.u) return null;
  const u = await lerJSON(env, 'u:' + d.u);
  if (!u) return null;                         // CPF removido pelo administrador
  const pid = u.perfil || d.u;
  const p = (await lerJSON(env, 'p:' + pid)) || perfilVazio(d.u);
  return { k: d.u, u, pid, p };
}

/* une o perfil de kNovo ao perfil de kBase (CPFs usados no mesmo dispositivo = mesma pessoa) */
async function ligarPerfis(env, kBase, kNovo) {
  if (!kBase || kBase === kNovo) return;
  const uB = await lerJSON(env, 'u:' + kBase), uN = await lerJSON(env, 'u:' + kNovo);
  if (!uB || !uN) return;
  const pidB = uB.perfil || kBase, pidN = uN.perfil || kNovo;
  if (pidB === pidN) return;
  const pB = (await lerJSON(env, 'p:' + pidB)) || perfilVazio(kBase);
  const pN = (await lerJSON(env, 'p:' + pidN)) || perfilVazio(kNovo);
  const cpfs = [...new Set([...pB.cpfs, ...pN.cpfs])];
  const temB = pB.dados && Object.keys(pB.dados).length > 0;
  const dados = temB ? pB.dados : (pB.dados === null ? pN.dados : pB.dados);   // o perfil já existente do aparelho tem prioridade
  const novo = { cpfs, v: Math.max(pB.v, pN.v) + 1, vApagado: Math.max(pB.vApagado, pN.vApagado), dados, atualizadoEm: new Date().toISOString() };
  for (const c of cpfs) {
    const u = c === kBase ? uB : c === kNovo ? uN : await lerJSON(env, 'u:' + c);
    if (!u) continue;
    u.perfil = pidB;
    await env.DB.put('u:' + c, JSON.stringify(u));
  }
  await env.DB.put('p:' + pidB, JSON.stringify(novo));
  if (pidN !== pidB) await env.DB.delete('p:' + pidN);
}

async function sessaoValida(env, request) { return !!(await contexto(env, request)); }

/* ---------- respostas ---------- */
const BASE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function json(obj, status = 200, cookie) {
  const h = new Headers({ ...BASE, 'Content-Type': 'application/json; charset=utf-8' });
  if (cookie) h.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(obj), { status, headers: h });
}
async function pagina(env, request, nome, status = 200, inserir = '') {
  const r = await env.ASSETS.fetch(new Request(new URL('/' + nome, request.url)));
  if (!r.ok) return new Response('Erro ao abrir a página.', { status: 500, headers: BASE });
  const h = { ...BASE, 'Content-Type': 'text/html; charset=utf-8' };
  if (!inserir) return new Response(r.body, { status, headers: h });
  return new Response((await r.text()).replace('<head>', '<head>' + inserir), { status, headers: h });
}

/* arquivos públicos para instalar o site como aplicativo (manifesto, service worker e ícones) */
const ESTATICOS = {
  '/manifest.webmanifest': ['application/manifest+json; charset=utf-8', 'no-cache'],
  '/sw.js': ['text/javascript; charset=utf-8', 'no-cache'],
  '/icons/icon-192.png': ['image/png', 'public, max-age=86400'],
  '/icons/icon-512.png': ['image/png', 'public, max-age=86400'],
  '/icons/icon-maskable-512.png': ['image/png', 'public, max-age=86400'],
  '/icons/apple-touch-icon.png': ['image/png', 'public, max-age=86400']
};
async function estatico(env, request, rota) {
  const r = await env.ASSETS.fetch(new Request(new URL(rota, request.url)));
  if (!r.ok) return new Response('Não encontrado.', { status: 404, headers: BASE });
  const [tipo, cache] = ESTATICOS[rota];
  return new Response(r.body, { status: 200, headers: { 'X-Content-Type-Options': 'nosniff', 'Content-Type': tipo, 'Cache-Control': cache } });
}

/* acesso ao Durable Object (instância única = consistência imediata) */
function abrirBanco(env) {
  const stub = env.BANCO.get(env.BANCO.idFromName('principal'));
  return { get: k => stub.ler(k), put: (k, v) => stub.gravar(k, v), delete: k => stub.apagar(k), segredo: () => stub.segredo() };
}

/* ---------- rotas ---------- */
export default {
  async fetch(request, env) {
    try {
      if (env.BANCO) env = { ...env, DB: abrirBanco(env) };
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
    const codigoAcesso = String(env.CODIGO_ACESSO || '');

    if (request.method === 'GET' || request.method === 'HEAD') {
      if (ESTATICOS[rota]) return estatico(env, request, rota);
      if (rota === '/') return Response.redirect(new URL('/recomeco.html', request.url).toString(), 302);
      if (rota === '/acesso.html') return pagina(env, request, 'acesso.html');
      if (rota === '/recomeco.html') {
        const ctx = env.DB ? await contexto(env, request) : null;
        if (ctx) {
          const estado = { pid: ctx.pid, v: ctx.p.v, existe: ctx.p.dados !== null, dados: ctx.p.dados || {} };
          const tag = '<script>window.__RC=' + JSON.stringify(estado).replace(/</g, '\\u003c') + ';</script>';
          return pagina(env, request, 'recomeco.html', 200, tag);
        }
        return pagina(env, request, 'bloqueado.html', 401);
      }
      if (rota === '/api/config') return json({ codigo: !!codigoAcesso });
      return new Response('Não encontrado.', { status: 404, headers: BASE });
    }

    if (request.method === 'POST' && rota.startsWith('/api/')) {
      if (!env.DB) return json({ erro: 'O banco de dados (Durable Object "BANCO") não está conectado ao Worker. Confira o wrangler.jsonc e faça o deploy de novo (LEIA-ME, passo 4).' }, 500);
      let b;
      try { b = await request.json(); } catch (e) { return json({ erro: 'Requisição inválida.' }, 400); }
      if (!b || typeof b !== 'object') return json({ erro: 'Requisição inválida.' }, 400);

      /* sair da conta: esquece este aparelho e apaga a sessão (volta para a tela de entrar com CPF) */
      if (rota === '/api/sair') {
        const id = String(b.deviceId || '');
        if (id.length >= 8 && id.length <= 100) {
          const dh = await hmac(env, 'dev', id);
          const dono = await env.DB.get('d:' + dh);
          if (dono) {
            const u = await lerJSON(env, 'u:' + dono);
            if (u && Array.isArray(u.dispositivos)) {
              u.dispositivos = u.dispositivos.filter(x => x !== dh);
              await env.DB.put('u:' + dono, JSON.stringify(u));
            }
            await env.DB.delete('d:' + dh);
          }
        }
        return json({ ok: true }, 200, 'rc_sessao=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
      }

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
        const id = String(b.deviceId || '');
        if (id.length < 8 || id.length > 100) return json({ erro: 'Dispositivo inválido.' }, 400);
        if (!cpfValido(b.cpf)) return json({ erro: 'CPF inválido. Confira os números.' }, 400);
        const k = await hmac(env, 'cpf', soDig(b.cpf)), dh = await hmac(env, 'dev', id);
        const agora = new Date().toISOString();
        let u = await lerJSON(env, 'u:' + k);
        /* conta já existe: entra só com o CPF (o código é para criar contas novas, não para entrar) */
        if (!u) {
          if (codigoAcesso) {
            const informado = String(b.codigo || '');
            if (!informado) return json({ erro: 'Este CPF ainda não tem conta. Para criar uma, informe o código de acesso.', precisaCodigo: true }, 403);
            if (informado !== codigoAcesso) { return json({ erro: 'Código de acesso incorreto.', precisaCodigo: true }, 403); }
          }
          u = { cpf: cpfMask(b.cpf), criadoEm: agora, dispositivos: [] };
        }
        if (!Array.isArray(u.dispositivos)) u.dispositivos = [];
        if (!u.dispositivos.includes(dh)) u.dispositivos.push(dh);
        u.ultimoAcesso = agora;
        await env.DB.put('u:' + k, JSON.stringify(u));
        const antes = await env.DB.get('d:' + dh);
        await env.DB.put('d:' + dh, k);
        if (antes && antes !== k) await ligarPerfis(env, antes, k);
        return json({ ok: true }, 200, await criarCookie(env, k));
      }

      /* entra só com CPF (quem abriu o recomeco direto) — precisa já ter conta; também lembra este aparelho */
      if (rota === '/api/entrar') {
        if (!cpfValido(b.cpf)) return json({ erro: 'CPF inválido. Confira os números.' }, 400);
        const k = await hmac(env, 'cpf', soDig(b.cpf));
        if (!(await env.DB.get('u:' + k))) { return json({ erro: 'CPF não cadastrado. O acesso não está liberado.' }, 404); }
        const idE = String(b.deviceId || '');
        if (idE.length >= 8 && idE.length <= 100) {
          const dh = await hmac(env, 'dev', idE);
          const dono = await env.DB.get('d:' + dh);
          if (dono && dono !== k) await ligarPerfis(env, dono, k);
          const u = await lerJSON(env, 'u:' + k);
          if (u) {
            if (!Array.isArray(u.dispositivos)) u.dispositivos = [];
            if (!u.dispositivos.includes(dh)) u.dispositivos.push(dh);
            u.ultimoAcesso = new Date().toISOString();
            await env.DB.put('u:' + k, JSON.stringify(u));
          }
          await env.DB.put('d:' + dh, k);
        }
        return json({ ok: true }, 200, await criarCookie(env, k));
      }

      /* ---- dados do app, ligados ao CPF (todas exigem sessão válida) ---- */
      if (rota === '/api/estado' || rota === '/api/salvar' || rota === '/api/apagar') {
        const ctx = await contexto(env, request);
        if (!ctx) return json({ erro: 'Sessão expirada. Entre novamente.' }, 401);
        const { pid, p } = ctx;

        /* lê o estado atual (usado ao voltar para a aba) */
        if (rota === '/api/estado') return json({ v: p.v, vApagado: p.vApagado || 0, existe: p.dados !== null, dados: p.dados || {} });

        /* grava só as chaves que mudaram (null = remover) */
        if (rota === '/api/salvar') {
          if (p.vApagado && Number(b.base) < p.vApagado) return json({ erro: 'Os dados foram apagados em outro dispositivo.', apagado: true }, 409);
          const m = b.mudancas;
          if (!m || typeof m !== 'object' || Array.isArray(m)) return json({ erro: 'Requisição inválida.' }, 400);
          const ks = Object.keys(m);
          if (ks.length > MAX_CHAVES) return json({ erro: 'Dados demais.' }, 400);
          const dados = { ...(p.dados || {}) };
          for (const c of ks) {
            const v = m[c];
            if (!chaveOk(c) || (v !== null && (typeof v !== 'string' || v.length > MAX_VALOR))) return json({ erro: 'Dados inválidos.' }, 400);
            if (v === null) delete dados[c]; else dados[c] = v;
          }
          if (JSON.stringify(dados).length > MAX_TOTAL) return json({ erro: 'Dados grandes demais.' }, 413);
          if (p.dados !== null && ks.every(c => m[c] === null ? !(c in p.dados) : p.dados[c] === m[c])) return json({ ok: true, v: p.v });   // nada mudou
          const novo = { ...p, dados, v: p.v + 1, atualizadoEm: new Date().toISOString() };
          await env.DB.put('p:' + pid, JSON.stringify(novo));
          return json({ ok: true, v: novo.v });
        }

        /* apaga os dados do perfil = de TODOS os CPFs ligados a ele (o acesso por CPF continua valendo) */
        const novo = { ...p, dados: {}, v: p.v + 1, atualizadoEm: new Date().toISOString() };
        novo.vApagado = novo.v;
        await env.DB.put('p:' + pid, JSON.stringify(novo));
        return json({ ok: true, v: novo.v, cpfs: p.cpfs.length });
      }
    }

    return new Response('Não encontrado.', { status: 404, headers: BASE });
  }
}
