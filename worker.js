/* Servidor de ativação do Recomeço (Cloudflare Workers + KV)
   Configuração:
   - Binding KV com o nome:  RC
   - Secret com o nome:      ADMIN_KEY        (sua senha de administrador)
   - Variável (opcional):    REQUIRE_APPROVAL = 1
       Se for 1, quem pedir acesso fica "aguardando aprovação" até você aprovar no painel.
       Se não existir, o acesso é liberado automaticamente na hora.  */
const CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return [...a].map(b=>CHARS[b%32]).join('')};
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...cors,'Content-Type':'application/json'}});
const normCode=t=>String(t||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const isDev=d=>/^[0-9a-f]{32}$/.test(d);

export default{async fetch(req,env){
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json({error:'Método inválido.'},405);
 const path=new URL(req.url).pathname;
 let b;try{b=JSON.parse(await req.text())}catch(e){return json({error:'Pedido inválido.'},400)}

 /* público: o site pede o acesso sozinho. O código é criado automaticamente e fica preso ao aparelho */
 if(path==='/join'){
  const dev=String(b.device||'');
  if(!isDev(dev))return json({error:'Aparelho inválido.'},400);
  let code=await env.RC.get('d:'+dev);
  if(!code){
   code=newCode();
   const name='Pessoa '+code.slice(0,4);
   await env.RC.put('c:'+code,JSON.stringify({name,created:Date.now(),device:dev,claimedAt:Date.now(),approved:env.REQUIRE_APPROVAL!=='1',revoked:false}));
   await env.RC.put('d:'+dev,code);
  }
  return json({ok:true,code});
 }

 /* público: valida o código neste aparelho (links antigos continuam valendo) */
 if(path==='/claim'){
  const code=normCode(b.code),dev=String(b.device||'');
  if(code.length!==12||!isDev(dev))return json({error:'Código inválido.'},400);
  const raw=await env.RC.get('c:'+code);
  if(!raw)return json({error:'Código inválido ou cancelado.'},404);
  const rec=JSON.parse(raw);
  if(rec.device&&rec.device!==dev)return json({error:'Este acesso já foi ativado em outro aparelho e não pode ser usado aqui.'},403);
  if(!rec.device){rec.device=dev;rec.claimedAt=Date.now();await env.RC.put('c:'+code,JSON.stringify(rec));await env.RC.put('d:'+dev,code)}
  if(rec.revoked)return json({error:'Seu acesso foi cancelado.'},403);
  if(rec.approved===false)return json({error:'Pedido enviado! Aguarde a aprovação e toque em Entrar de novo.',pending:true},403);
  return json({ok:true});
 }

 /* administrador */
 if(!env.ADMIN_KEY||b.admin!==env.ADMIN_KEY)return json({error:'Senha de administrador incorreta.'},401);
 if(path==='/list'){
  const l=await env.RC.list({prefix:'c:'});
  const items=await Promise.all(l.keys.map(async k=>{const r=JSON.parse(await env.RC.get(k.name)||'null');return r&&{code:k.name.slice(2),name:r.name,created:r.created,claimedAt:r.claimedAt,claimed:!!r.device,approved:r.approved!==false,revoked:!!r.revoked}}));
  return json({ok:true,items:items.filter(Boolean).sort((a,b)=>b.created-a.created)});
 }
 if(path==='/approve'||path==='/revoke'){
  const code=normCode(b.code),raw=await env.RC.get('c:'+code);
  if(!raw)return json({error:'Código não encontrado.'},404);
  const rec=JSON.parse(raw);
  if(path==='/approve'){rec.approved=true;rec.revoked=false}else rec.revoked=true;
  await env.RC.put('c:'+code,JSON.stringify(rec));
  return json({ok:true});
 }
 return json({error:'Rota inexistente.'},404);
}};
