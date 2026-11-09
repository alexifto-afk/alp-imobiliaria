const mailbox = value => /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
const trim = value => String(value || '').trim();
const failure = code => Object.assign(new Error('Falha no envio do e-mail de recuperação'), {code});

export function emailConfigured(env) {
  return mailbox(trim(env.GMAIL_USER)) && ['GMAIL_CLIENT_ID','GMAIL_CLIENT_SECRET','GMAIL_REFRESH_TOKEN'].every(key => Boolean(trim(env[key])));
}

function message(from, to, code) {
  if (!mailbox(from) || !mailbox(to) || !/^\d{6}$/.test(code)) throw failure('GMAIL_INVALID_MESSAGE');
  const encoded = text => '=?UTF-8?B?' + Buffer.from(text, 'utf8').toString('base64') + '?=';
  const text = `Seu código de recuperação é ${code}. Ele expira em 10 minutos. Se você não solicitou a recuperação, ignore esta mensagem. Não compartilhe este código.`;
  const body = Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g).join('\r\n');
  return Buffer.from([
    'From: ' + encoded('A.L.P Imobiliária') + ' <' + from + '>',
    'To: <' + to + '>',
    'Subject: ' + encoded('A.L.P Imobiliária — recuperação de senha'),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '', body
  ].join('\r\n'), 'utf8').toString('base64url');
}

// HTTPS, compatível com Render gratuito. Não usa SMTP nem senha de app.
export function createEmailSender({env, fetchImpl = fetch, now = () => Date.now()}) {
  let cached = null;
  let refreshing = null;
  async function accessToken() {
    if (cached && cached.expiresAt > now()) return cached.value;
    if (!refreshing) {
      refreshing = (async () => {
        let response;
        try {
          response = await fetchImpl('https://oauth2.googleapis.com/token', {
            method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'},
            body: new URLSearchParams({client_id:trim(env.GMAIL_CLIENT_ID), client_secret:trim(env.GMAIL_CLIENT_SECRET),
              refresh_token:trim(env.GMAIL_REFRESH_TOKEN), grant_type:'refresh_token'}).toString(),
            signal: AbortSignal.timeout(12000)
          });
        } catch { throw failure('GMAIL_AUTH_UNAVAILABLE'); }
        const data = await response.json().catch(() => ({}));
        if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) throw failure('GMAIL_AUTH_FAILED');
        const lifetime = Number(data.expires_in);
        cached = {value:data.access_token, expiresAt:now() + (Number.isFinite(lifetime) && lifetime > 30 ? lifetime - 30 : 0) * 1000};
        return cached.value;
      })().finally(() => {refreshing = null;});
    }
    return refreshing;
  }
  return async (to, code) => {
    if (!emailConfigured(env)) throw failure('GMAIL_NOT_CONFIGURED');
    const raw = message(trim(env.GMAIL_USER), to, code);
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await accessToken();
      let response;
      try {
        response = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method:'POST', headers:{Authorization:'Bearer ' + token, 'Content-Type':'application/json'},
          body:JSON.stringify({raw}), signal:AbortSignal.timeout(12000)
        });
      } catch { throw failure('GMAIL_SEND_UNAVAILABLE'); }
      if (response.status === 401 && attempt === 0) {cached = null;continue;}
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.id !== 'string' || !data.id) throw failure(response.status === 429 ? 'GMAIL_QUOTA' : 'GMAIL_SEND_FAILED');
      return;
    }
    throw failure('GMAIL_AUTH_FAILED');
  };
}
