'use strict';
/* Recomeço — servidor de acesso (Node.js, sem dependências)
   Banco de dados: data/db.json  |  Rodar: node server.js */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const CODIGO_ACESSO = process.env.CODIGO_ACESSO || '';      // opcional: exige código para CADASTRAR
const TRUST_PROXY = process.env.TRUST_PROXY === '1';        // 1 se estiver atrás de proxy/Render/Railway
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';    // 1 se usar HTTPS
const SESSAO_MS = 12 * 60 * 60 * 1000;                      // sessão de 12 horas

const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });
const DB_FILE = path.join(DATA, 'db.json');
const KEY_FILE = path.join(DATA, 'segredo.key');

/* ---------- segredo (assina sessões e protege os CPFs) ---------- */
let SEGREDO = process.env.SEGREDO || '';
if (!SEGREDO) {
  try { SEGREDO = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch (e) {}
  if (!SEGREDO) {
    SEGREDO = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(KEY_FILE, SEGREDO, { mode: 0o600 });
  }
}
const hmac = (tag, v) => crypto.createHmac('sha256', SEGREDO).update(tag + '|' + v).digest('hex');

/* ---------- banco de dados (arquivo JSON) ---------- */
let db = { usuarios: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {}
if (!db.usuarios) db.usuarios = {};
function salvar() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
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
const cpfHash = c => hmac('cpf', soDig(c));
const devHash = d => hmac('dev', d);
const cpfMask = c => { c = soDig(c); return '***.' + c.slice(3, 6) + '.' + c.slice(6, 9) + '-**'; };

function acharPorDispositivo(id) {
  const h = devHash(id);
  for (const k of Object.keys(db.usuarios)) {
    if ((db.usuarios[k].dispositivos || []).includes(h)) return k;
  }
  return null;
}

/* ---------- sessão (cookie assinado) ---------- */
const b64 = s => Buffer.from(s).toString('base64url');
function criarToken(u) {
  const p = b64(JSON.stringify({ u, exp: Date.now() + SESSAO_MS }));
  return p + '.' + hmac('sessao', p);
}
function lerToken(t) {
  if (!t || t.indexOf('.') < 0) return null;
  const [p, sig] = t.split('.');
  const esperado = hmac('sessao', p);
  const a = Buffer.from(sig || ''), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!d.exp || d.exp < Date.now()) return null;
    if (!db.usuarios[d.u]) return null;   // removeu do banco = acesso revogado
    return d;
  } catch (e) { return null; }
}
function cookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(x => {
    const i = x.indexOf('=');
    if (i > 0) o[x.slice(0, i).trim()] = decodeURIComponent(x.slice(i + 1).trim());
  });
  return o;
}
function setSessao(res, u) {
  res.setHeader('Set-Cookie', 'rc_sessao=' + criarToken(u) + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' +
    Math.floor(SESSAO_MS / 1000) + (COOKIE_SECURE ? '; Secure' : ''));
}
const sessaoValida = req => !!lerToken(cookies(req).rc_sessao);

/* ---------- limite de tentativas ---------- */
const hits = new Map(), trava = new Map();
function ipDe(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}
function limite(ip, chave, max, janela) {
  const k = chave + '|' + ip, agora = Date.now();
  const a = (hits.get(k) || []).filter(t => agora - t < janela);
  a.push(agora); hits.set(k, a);
  return a.length <= max;
}
function travado(ip) { const t = trava.get(ip); return t && t.ate > Date.now() ? Math.ceil((t.ate - Date.now()) / 1000) : 0; }
function falhou(ip) {
  const t = trava.get(ip) || { n: 0, ate: 0 };
  t.n++;
  if (t.n >= 5) { t.n = 0; t.ate = Date.now() + 60000; }
  trava.set(ip, t);
}
setInterval(() => { const agora = Date.now(); for (const [k, a] of hits) if (!a.some(t => agora - t < 600000)) hits.delete(k); }, 600000).unref();

/* ---------- utilidades HTTP ---------- */
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
function json(res, code, obj) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, BASE_HEADERS));
  res.end(JSON.stringify(obj));
}
function arquivo(res, code, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(500, BASE_HEADERS); return res.end('Erro ao abrir o arquivo.'); }
    res.writeHead(code, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, BASE_HEADERS));
    res.end(data);
  });
}
function corpo(req) {
  return new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 10000) { req.destroy(); resolve(null); } });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

/* ---------- rotas ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const rota = url.pathname;
  const ip = ipDe(req);

  if (req.method === 'GET') {
    if (rota === '/' ) { res.writeHead(302, { Location: '/acesso.html' }); return res.end(); }
    if (rota === '/acesso.html') return arquivo(res, 200, path.join(__dirname, 'public', 'acesso.html'));
    if (rota === '/recomeco.html') {
      if (sessaoValida(req)) return arquivo(res, 200, path.join(__dirname, 'private', 'recomeco.html'));
      return arquivo(res, 401, path.join(__dirname, 'public', 'bloqueado.html'));
    }
    if (rota === '/api/config') return json(res, 200, { codigo: !!CODIGO_ACESSO });
    res.writeHead(404, BASE_HEADERS); return res.end('Não encontrado.');
  }

  if (req.method === 'POST' && rota.startsWith('/api/')) {
    if (!limite(ip, 'api', 40, 60000)) return json(res, 429, { erro: 'Muitas requisições. Aguarde um instante.' });
    const b = await corpo(req);
    if (!b) return json(res, 400, { erro: 'Requisição inválida.' });

    /* o dispositivo já está cadastrado? se sim, libera sem pedir CPF */
    if (rota === '/api/dispositivo') {
      const id = String(b.deviceId || '');
      if (id.length < 8 || id.length > 100) return json(res, 400, { erro: 'Dispositivo inválido.' });
      const u = acharPorDispositivo(id);
      if (!u) return json(res, 200, { cadastrado: false });
      db.usuarios[u].ultimoAcesso = new Date().toISOString(); salvar();
      setSessao(res, u);
      return json(res, 200, { cadastrado: true });
    }

    /* cadastra o CPF (e liga este dispositivo a ele) */
    if (rota === '/api/cadastrar') {
      const w = travado(ip);
      if (w) return json(res, 429, { erro: 'Muitas tentativas. Aguarde ' + w + 's.' });
      if (!limite(ip, 'cad', 10, 60000)) return json(res, 429, { erro: 'Muitas tentativas. Aguarde um instante.' });
      const id = String(b.deviceId || '');
      if (id.length < 8 || id.length > 100) return json(res, 400, { erro: 'Dispositivo inválido.' });
      if (CODIGO_ACESSO && String(b.codigo || '') !== CODIGO_ACESSO) { falhou(ip); return json(res, 403, { erro: 'Código de acesso incorreto.' }); }
      if (!cpfValido(b.cpf)) return json(res, 400, { erro: 'CPF inválido. Confira os números.' });
      const k = cpfHash(b.cpf), dh = devHash(id), agora = new Date().toISOString();
      if (!db.usuarios[k]) db.usuarios[k] = { cpf: cpfMask(b.cpf), criadoEm: agora, dispositivos: [] };
      if (!db.usuarios[k].dispositivos.includes(dh)) db.usuarios[k].dispositivos.push(dh);
      db.usuarios[k].ultimoAcesso = agora;
      salvar();
      setSessao(res, k);
      return json(res, 200, { ok: true });
    }

    /* entra só com CPF (quem abriu o recomeco direto) — precisa já estar cadastrado */
    if (rota === '/api/entrar') {
      const w = travado(ip);
      if (w) return json(res, 429, { erro: 'Muitas tentativas. Aguarde ' + w + 's.' });
      if (!limite(ip, 'ent', 10, 60000)) return json(res, 429, { erro: 'Muitas tentativas. Aguarde um instante.' });
      if (!cpfValido(b.cpf)) return json(res, 400, { erro: 'CPF inválido. Confira os números.' });
      const k = cpfHash(b.cpf);
      if (!db.usuarios[k]) { falhou(ip); return json(res, 404, { erro: 'CPF não cadastrado. O acesso não está liberado.' }); }
      trava.delete(ip);
      db.usuarios[k].ultimoAcesso = new Date().toISOString(); salvar();
      setSessao(res, k);
      return json(res, 200, { ok: true });
    }
  }

  res.writeHead(404, BASE_HEADERS); res.end('Não encontrado.');
});

server.listen(PORT, () => {
  console.log('Recomeço rodando em http://localhost:' + PORT);
  console.log('Banco de dados: ' + DB_FILE + (CODIGO_ACESSO ? '  |  cadastro protegido por código' : '  |  cadastro aberto (defina CODIGO_ACESSO para proteger)'));
});
