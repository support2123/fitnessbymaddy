import { supa } from './_lib/supabase.js';
import { normalizePhone, maskPhone } from './_lib/mask.js';
import { marketFromPhone } from './_lib/market.js';
import { routeKeyword, checkoutUrl, intakeUrl } from './_lib/router.js';
import { sendWhatsApp, logMessage } from './_lib/whatsapp.js';
import { render, TEMPLATES } from './_lib/templates.js';
import { detectRedFlags, escalate } from './_lib/escalation.js';
import { json, readBody } from './_lib/http.js';

// Handles both AiSensy incoming webhooks and Meta Cloud API webhooks.
export default async function handler(req, res) {
  // Meta verify handshake (GET hub.challenge)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.META_WA_VERIFY_TOKEN) {
      res.status(200).send(challenge);
      return;
    }
    return json(res, 403, { error: 'verify failed' });
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'method' });

  try {
    const body = await readBody(req);
    const parsed = parseIncoming(body);
    if (!parsed) return json(res, 200, { ok: true, ignored: true });

    await processIncoming(parsed);
    return json(res, 200, { ok: true });
  } catch (e) {
    console.error('webhook error:', e.message);
    return json(res, 200, { ok: false, error: 'internal' }); // 200 to avoid retries loops
  }
}

function parseIncoming(body) {
  // AiSensy shape: { type:'message', from:'+91...', text:'...', senderName:'...' }
  if (body?.type === 'message' && body?.from) {
    return { phone: normalizePhone(body.from), text: String(body.text || body.body || '').trim(), name: body.senderName || null };
  }
  // Meta shape
  const entry = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = entry?.messages?.[0];
  if (msg?.from) {
    const text = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || '';
    const contact = entry?.contacts?.[0];
    return { phone: normalizePhone('+' + msg.from.replace(/^\+?/, '')), text: String(text).trim(), name: contact?.profile?.name || null };
  }
  return null;
}

async function processIncoming({ phone, text, name }) {
  const db = supa();
  const { market, lang } = marketFromPhone(phone);

  await logMessage({ phone, direction: 'in', body: text });

  // Opt-out
  if (/^\s*(stop|unsubscribe|remove me)\s*$/i.test(text)) {
    await db.from('leads').upsert(
      { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
      { onConflict: 'phone' }
    );
    try {
      await sendWhatsApp({
        to: phone,
        templateName: TEMPLATES.opt_out_ack.name,
        body: render('opt_out_ack', lang),
        bypassRateLimit: true
      });
    } catch {}
    return;
  }

  // Red-flag escalation first (but still respond)
  const flags = detectRedFlags(text);
  if (flags.length) {
    const existing = await db.from('leads').select('id').eq('phone', phone).maybeSingle();
    const client = await db.from('clients').select('id').eq('phone', phone).maybeSingle();
    await escalate({
      phone,
      leadId: existing?.data?.id,
      clientId: client?.data?.id,
      reason: flags.join(','),
      context: text
    });
  }

  // Upsert lead
  const { data: existing } = await db.from('leads').select('*').eq('phone', phone).maybeSingle();
  const nowIso = new Date().toISOString();

  if (!existing) {
    const { data: inserted } = await db.from('leads').insert({
      phone,
      name,
      status: 'new',
      source: 'whatsapp',
      first_msg: text,
      last_msg_at: nowIso,
      market
    }).select('id').single();

    // Flow A — welcome
    await sendWhatsApp({
      to: phone,
      templateName: TEMPLATES.welcome_v1.name,
      body: render('welcome_v1', lang)
    });
    return { leadId: inserted?.id, action: 'welcomed' };
  }

  // Existing lead: update last_msg, maybe qualify
  await db.from('leads').update({
    last_msg_at: nowIso,
    name: existing.name || name
  }).eq('id', existing.id);

  if (existing.status === 'dropped') return { action: 'ignored_dropped' };

  // Flow B — route
  const route = routeKeyword(text);
  if (route) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: route.program
    }).eq('id', existing.id);

    await sendWhatsApp({
      to: phone,
      templateName: TEMPLATES.program_cta.name,
      body: render('program_cta', lang, {
        label: route.label,
        checkout: checkoutUrl(route.program),
        intake: intakeUrl(existing.id)
      }),
      params: [route.label, checkoutUrl(route.program), intakeUrl(existing.id)]
    });
    return { action: 'routed', program: route.program };
  }

  // No keyword match: keep conversation alive with a gentle clarifier.
  await sendWhatsApp({
    to: phone,
    body: lang === 'hinglish'
      ? 'Thoda aur batao — main goal kya hai? (fat loss / PCOS / strength / 40+ / trial)'
      : "Tell me a bit more — what's the main goal? (fat loss / PCOS / strength / 40+ / trial)"
  });
  return { action: 'clarified' };
}
