import crypto from 'node:crypto';

export const RESET_MESSAGE = 'Se houver uma conta ativa com e-mail cadastrado, você receberá um código. Confira também o spam.';
const ttl = 10 * 60 * 1000;
const cooldown = 60 * 1000;
const invalid = () => Object.assign(new Error('Código inválido ou expirado. Confira o código ou solicite outro.'), {status: 400});
const digits = value => String(value || '').replace(/\D/g, '');
const validCpf = value => /^\d{11}$/.test(digits(value));
const lockUser = (tx, id) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))::text`;
export const credentialVersion = (passwordHash, secret) => crypto.createHmac('sha256', secret).update(passwordHash).digest('hex');

export function maskRecoveryEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  const [local, domain] = value.split('@');
  const visible = local.length > 3 ? local.slice(0, 2) : local.length > 1 ? local.slice(0, 1) : '';
  const labels = domain.split('.');
  const maskedDomain = labels.map((label, index) => index === labels.length - 1 ? label : (label.length > 1 ? label[0] : '') + '***').join('.');
  return visible + '***@' + maskedDomain;
}

export function validNewPassword(value) {
  return typeof value === 'string' && value.length >= 10 && value.length <= 72 && Buffer.byteLength(value, 'utf8') <= 72;
}

export function createPasswordReset({db, secret, hashPassword, sendEmail, now = () => Date.now(), randomCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0'), onDeliveryError = () => {}}) {
  const key = crypto.createHash('sha256').update(secret + ':alp-password-reset').digest();
  const hash = (id, code) => crypto.createHmac('sha256', key).update(id + ':' + code).digest('hex');
  const response = emailHint => ({ok: true, message: RESET_MESSAGE, retryAfterSeconds: 60, expiresInSeconds: 600, ...(emailHint ? {emailHint} : {})});
  function input(body) {
    if (!body || !validCpf(body.cpf) || (body.channel && body.channel !== 'EMAIL')) {
      throw Object.assign(new Error('Informe um CPF com 11 dígitos para recuperar por e-mail.'), {status: 400});
    }
  }
  async function request(body) {
    input(body);
    const user = await db.user.findUnique({where: {cpf: digits(body.cpf)}, include: {client: true}});
    const email = String(user?.client?.email || '').trim().toLowerCase();
    if (!user?.active || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response();
    const code = randomCode();
    const reset = await db.$transaction(async tx => {
      await lockUser(tx, user.id);
      const recent = await tx.passwordReset.findFirst({where: {userId: user.id, createdAt: {gte: new Date(now() - cooldown)}}, orderBy: {createdAt: 'desc'}});
      if (recent) return null;
      await tx.passwordReset.updateMany({where: {userId: user.id, usedAt: null}, data: {usedAt: new Date(now())}});
      return tx.passwordReset.create({data: {userId: user.id, channel: 'EMAIL', codeHash: hash(user.id, code), expiresAt: new Date(now() + ttl)}});
    });
    if (reset) {
      try { await sendEmail(email, code); }
      catch (error) {
        await db.passwordReset.delete({where: {id: reset.id}});
        // Não devolve status diferente que revele a existência do CPF.
        onDeliveryError(error.code || 'EMAIL_DELIVERY_FAILED');
      }
    }
    return response(maskRecoveryEmail(email));
  }
  async function validate(tx, body, consume) {
    const user = await tx.user.findUnique({where: {cpf: digits(body.cpf)}});
    if (!user?.active) return {error: invalid()};
    await lockUser(tx, user.id);
    const reset = await tx.passwordReset.findFirst({where: {userId: user.id, channel: 'EMAIL', usedAt: null}, orderBy: {createdAt: 'desc'}});
    if (!reset || reset.expiresAt <= new Date(now()) || reset.attempts >= 5) return {error: invalid()};
    const expected = Buffer.from(reset.codeHash, 'hex');
    const actual = Buffer.from(hash(user.id, String(body.code)), 'hex');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      await tx.passwordReset.updateMany({where: {id: reset.id, usedAt: null, attempts: {lt: 5}}, data: {attempts: {increment: 1}}});
      return {error: invalid()};
    }
    if (consume) {
      const claim = await tx.passwordReset.updateMany({where: {id: reset.id, usedAt: null, attempts: {lt: 5}, expiresAt: {gt: new Date(now())}}, data: {usedAt: new Date(now())}});
      if (!claim.count) return {error: invalid()};
      await tx.user.update({where: {id: user.id}, data: {passwordHash: await hashPassword(body.newPassword), mustChangePassword: false}});
      await tx.passwordReset.updateMany({where: {userId: user.id, usedAt: null}, data: {usedAt: new Date(now())}});
    }
    return {ok: true};
  }
  async function check(body, consume) {
    input(body);
    if (!/^\d{6}$/.test(String(body.code || ''))) throw invalid();
    if (consume && !validNewPassword(body.newPassword)) throw Object.assign(new Error('A nova senha deve ter entre 10 e 72 caracteres. Se usar muitos acentos ou símbolos, escolha uma senha mais curta.'), {status: 400});
    const result = await db.$transaction(tx => validate(tx, body, consume));
    if (result.error) throw result.error;
    return {ok: true};
  }
  return {request, verify: body => check(body, false), confirm: body => check(body, true)};
}
