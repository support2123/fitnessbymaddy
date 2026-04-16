// AiSensy webhook (POST). Falls back to Meta Cloud API verification (GET) if
// only Meta is configured. Drives Flow A (new lead) and Flow B (qualification).

import { db, maskPhone } from '../lib/supabase.js';
import { logInbound, sendWhatsApp } from '../lib/whatsapp.js';
import { detectMarket } from '../lib/market.js';
import { render } from '../lib/templates.js';
import { routeProgram, checkoutUrl, intakeUrl } from '../lib/routing.js';
import { detectEscalations, escalate } from '../lib/escalation.js';
import { readJson, json, methodNotAllowed } from '../lib/http.js';

export default async function handler(req, res) {
  // Meta Cloud API GET verify
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token && token === process.env.META_WA_VERIFY_TOKEN) {
      res.statusCode = 200; res.end(String(challenge || '')); return;
    }
    res.statusCode = 403; res.end('forbidden'); return;
  }
  if (req.method !== 'POST') return methodNotAllowed(res, 'GET, POST');

  const body = await readJson(req);
  // Normalise inbound shape across AiSensy / Meta.
  const inbound = extractInbound(body);
  if (!inbound) return json(res, 200, { ok: true, ignored: true });

  const { phone, text, name, meta } = inbound;
  await logInbound({ phone, body: text, meta });

  // Opt-out handling
  if (/^\s*(stop|unsubscribe|opt[- ]?out|band karo)\s*$/i.test(text || '')) {
    await db().from('leads').upsert(
      { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
      { onConflict: 'phone' }
    );
    return json(res, 200, { ok: true, dropped: true });
  }

  // Upsert lead
  const market = detectMarket(phone);
  const { data: existing } = await db()
    .from('leads').select('*').eq('phone', phone).limit(1).maybeSingle();

  let lead = existing;
  if (!existing) {
    const { data: inserted } = await db()
      .from('leads').insert({
        phone, name, first_msg: text, market,
        last_msg_at: new Date().toISOString(), source: meta?.source || 'whatsapp'
      }).select().single();
    lead = inserted;
  } else {
    await db().from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existing.id);
  }

  // Escalation keywords → flag, but continue the auto-reply
  const flags = detectEscalations(text);
  for (const reason of flags) {
    await escalate({ phone, body: text, leadId: lead?.id, reason });
  }

  // Flow A: first-ever message → welcome
  if (!existing) {
    const t = render('welcome_v1', market);
    await sendWhatsApp({ phone, body: t.body, templateName: t.name, force: true });
    return json(res, 200, { ok: true, flow: 'welcome' });
  }

  // Flow B: intent routing
  const route = routeProgram(text);
  if (route) {
    await db().from('leads').update({
      status: 'qualified',
      program_interest: route.program
    }).eq('id', lead.id);

    const t = render('qualify_link', market, {
      checkoutUrl: checkoutUrl(route.slug),
      intakeUrl: intakeUrl(lead.id),
      programName: route.display
    });
    await sendWhatsApp({ phone, body: t.body, templateName: t.name, force: true });
    return json(res, 200, { ok: true, flow: 'qualified', program: route.program });
  }

  // No clear intent → stay quiet (the cron handles nudges)
  return json(res, 200, { ok: true, flow: 'logged' });
}

function extractInbound(body) {
  // AiSensy: { phone, name, text, timestamp, ... }
  if (body?.phone && (body?.text || body?.message)) {
    return {
      phone: '+' + String(body.phone).replace(/^\+?/, ''),
      text: body.text || body.message,
      name: body.name,
      meta: { source: 'aisensy', raw: trimmed(body) }
    };
  }
  // Meta Cloud API shape
  const entry = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = entry?.messages?.[0];
  if (msg && msg.from) {
    const text = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || '';
    const contact = entry.contacts?.[0];
    return {
      phone: '+' + msg.from,
      text,
      name: contact?.profile?.name,
      meta: { source: 'meta', raw: trimmed(msg) }
    };
  }
  return null;
}

function trimmed(obj) {
  // Cap at ~2KB so we never blow up the messages.meta column with a huge payload.
  try {
    const s = JSON.stringify(obj);
    return s.length > 2048 ? { _truncated: true, head: s.slice(0, 2048) } : obj;
  } catch { return {}; }
}
