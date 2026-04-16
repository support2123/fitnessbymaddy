// AiSensy (primary) + Meta Cloud API (fallback) WhatsApp sender.
// Rate-limit: max 1 outbound per phone per 2 hrs (except opted-in clients or bypass).

const { admin } = require('./supabase');
const { maskPhone, normalisePhone } = require('./utils');

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

async function wasRecentlyMessaged(phone) {
  const sb = admin();
  const since = new Date(Date.now() - TWO_HOURS_MS).toISOString();
  const { data, error } = await sb.from('messages')
    .select('id,sent_at')
    .eq('phone', phone).eq('direction', 'out')
    .gte('sent_at', since).limit(1);
  if (error) return false;
  return (data || []).length > 0;
}

async function isActiveClient(phone) {
  const sb = admin();
  const { data } = await sb.from('clients').select('id,status').eq('phone', phone).limit(1).maybeSingle();
  return !!(data && data.status === 'active');
}

async function isOptedOut(phone) {
  const sb = admin();
  const { data } = await sb.from('leads').select('opted_out').eq('phone', phone).maybeSingle();
  return !!(data && data.opted_out);
}

async function logMessage({ phone, direction, body, template, status }) {
  try {
    await admin().from('messages').insert({
      phone, direction, body: body ? body.slice(0, 4000) : null,
      template_name: template || null, status: status || null,
    });
  } catch (_) { /* non-fatal */ }
}

async function postAiSensy({ to, campaignName, userName = '', templateParams = [], media = null }) {
  const key = process.env.AISENSY_API_KEY;
  if (!key) throw new Error('AISENSY_API_KEY missing');
  const payload = {
    apiKey: key,
    campaignName,
    destination: to,
    userName: userName || 'Client',
    templateParams,
    source: 'api',
    media,
  };
  const r = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`aisensy_${r.status}:${text.slice(0, 200)}`);
  return { provider: 'aisensy', status: r.status, body: text };
}

async function postMeta({ to, body }) {
  const token = process.env.META_WA_TOKEN;
  const phoneId = process.env.META_WA_PHONE_ID;
  if (!token || !phoneId) throw new Error('meta_fallback_not_configured');
  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to.replace(/^\+/, ''),
      type: 'text',
      text: { body: body.slice(0, 1024) },
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`meta_${r.status}:${text.slice(0, 200)}`);
  return { provider: 'meta', status: r.status, body: text };
}

/**
 * Send a WhatsApp message.
 * @param {object} opts
 * @param {string} opts.to       E.164 phone (+91…)
 * @param {string} [opts.body]   plain-text body (used for audit + Meta fallback)
 * @param {string} [opts.campaignName]  AiSensy campaign/template name
 * @param {string} [opts.userName]      recipient display name
 * @param {string[]} [opts.templateParams]
 * @param {object} [opts.media]  {url, filename} for AiSensy media templates
 * @param {boolean} [opts.bypassRateLimit]
 * @returns {Promise<{sent:boolean, reason?:string, provider?:string}>}
 */
async function sendText(opts) {
  const to = normalisePhone(opts.to);
  if (!to) return { sent: false, reason: 'invalid_phone' };

  if (!opts.bypassRateLimit) {
    if (await isOptedOut(to)) return { sent: false, reason: 'opted_out' };
    const client = await isActiveClient(to);
    if (!client) {
      const recent = await wasRecentlyMessaged(to);
      if (recent) return { sent: false, reason: 'rate_limited_2h' };
    }
  }

  let result;
  try {
    if (opts.campaignName) {
      result = await postAiSensy(opts);
    } else if (process.env.META_WA_TOKEN) {
      result = await postMeta({ to, body: opts.body || '' });
    } else {
      throw new Error('no_provider');
    }
  } catch (e) {
    // Fallback chain: AiSensy -> Meta -> fail
    try {
      if (opts.body && process.env.META_WA_TOKEN) {
        result = await postMeta({ to, body: opts.body });
      } else {
        throw e;
      }
    } catch (e2) {
      await logMessage({
        phone: to, direction: 'out', body: opts.body || '',
        template: opts.campaignName, status: `failed:${String(e2.message || e2).slice(0, 200)}`,
      });
      console.error(`[wa-send-fail] ${maskPhone(to)} ${e2.message || e2}`);
      return { sent: false, reason: 'provider_error' };
    }
  }

  await logMessage({
    phone: to, direction: 'out', body: opts.body || '',
    template: opts.campaignName, status: `sent:${result.provider}`,
  });
  return { sent: true, provider: result.provider };
}

module.exports = { sendText, logMessage, wasRecentlyMessaged };
