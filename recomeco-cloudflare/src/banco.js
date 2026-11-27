/* Banco de dados do Recomeço: um Durable Object (SQLite) com consistência imediata.
   - Uma única instância guarda tudo; cada gravação já vale para todos os aparelhos, sem atraso entre regiões.
   - Sem o limite de ~1.000 gravações/dia do plano gratuito do KV.
   - Migração automática: se uma chave ainda não existe aqui mas existe no KV antigo (binding "DB"), é copiada na primeira leitura. */
import { DurableObject } from 'cloudflare:workers';

export class Banco extends DurableObject {
  async ler(k) {
    const v = await this.ctx.storage.get(k);
    if (v !== undefined) return v;
    if (await this.ctx.storage.get('~' + k)) return null;      // apagada de propósito: não "ressuscitar" do KV
    const kv = this.env && this.env.DB;
    if (kv && typeof kv.get === 'function') {
      try {
        const antigo = await kv.get(k);
        if (antigo !== null && antigo !== undefined) { await this.ctx.storage.put(k, antigo); return antigo; }
      } catch (e) { /* KV antigo indisponível: segue como se não existisse */ }
    }
    return null;
  }
  async gravar(k, v) {
    await this.ctx.storage.put(k, v);
    await this.ctx.storage.delete('~' + k);
    return true;
  }
  async apagar(k) {
    await this.ctx.storage.delete(k);
    await this.ctx.storage.put('~' + k, 1);
    const kv = this.env && this.env.DB;
    if (kv && typeof kv.delete === 'function') { try { await kv.delete(k); } catch (e) {} }
    return true;
  }
  /* chave que assina sessões e esconde os CPFs: criada UMA vez, de forma atômica, e nunca muda */
  async segredo() {
    return this.ctx.blockConcurrencyWhile(async () => {
      let s = await this.ler('segredo');
      if (!s) {
        const b = crypto.getRandomValues(new Uint8Array(32));
        s = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
        await this.gravar('segredo', s);
      }
      return s;
    });
  }
}
