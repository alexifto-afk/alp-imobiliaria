import crypto from 'node:crypto';

export function validMpSignature(req, paymentId, secret, now = Date.now()) {
  const signature = String(req.get('x-signature') || '');
  const requestId = String(req.get('x-request-id') || '');
  const ts = signature.match(/(?:^|,)\s*ts=([^,]+)/)?.[1];
  const v1 = signature.match(/(?:^|,)\s*v1=([a-f0-9]+)/i)?.[1];
  if (!secret || !requestId || !ts || !/^\d+$/.test(ts) || !v1 || !/^[a-f0-9]{64}$/i.test(v1)) return false;
  // O manifesto usa o texto original; somente a comparação de idade converte segundos.
  const timestamp = Number(ts) * (ts.length <= 10 ? 1000 : 1);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 10 * 60 * 1000) return false;
  const dataId = String(req.query['data.id'] || paymentId).toLowerCase();
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest();
  return crypto.timingSafeEqual(Buffer.from(v1, 'hex'), expected);
}
