// AiSensy + Meta Cloud API compatible inbound webhook.

import { supa, upsertLead, updateLead, getLeadByPhone, logMessage } from '../lib/supabase.js';
import { sendTemplate, sendText } from '../lib/aisensy.js';
import { canSend } from '../lib/rate-limit.js';
import { routeKeyword, checkoutUrl, intakeUrl, COPY } from '../lib/router.js';
import {
  normalisePhone, detectMarket, isOptOut, escalationReason,
  jsonResponse, readBody, maskPhone
} from '../lib/utils.js';

export default async function handler(req, res) {
  // Meta verification handshake (fallback provider).
  if (req.method === 'GET') {
    const mode = req.query?.['hub.mode'];
    const token = req.query?.['hub.verify_token'];
    const challenge = req.query?.['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.AISENSY_WEBHOOK_SECRET) {
      res.statusCode = 200; res.end(String(challenge || 'ok')); return;
    }
    return jsonResponse(res, 403, { error: 'verify_failed' });
  }

  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'POST only' });

  // Shared secret header (AiSensy) — best-effort check.
  const hdrSecret = req.headers['x-aisensy-secret'] || req.headers['x-webhook-secret'];
  if (process.env.AISENSY_WEBHOOK_SECRET && hdrSecret &&
      hdrSecret !== process.env.AISENSY_WEBHOOK_SECRET) {
    return jsonResponse(res, 401, { error: 'bad_secret' });
  }

  const raw = await readBody(req);
  const parsed = parseInbound(raw);
  if (!parsed) return jsonResponse(res, 200, { ok: true, skipped: 'no_message' });

  const { phone, text, name } = parsed;
  const norm = normalisePhone(phone);
  if (!norm) return jsonResponse(res, 200, { ok: true, skipped: 'bad_phone' });

  await logMessage({ phone: norm, direction: 'in', body: text, status: 'received' });

  // Opt-out wins everything.
  if (isOptOut(text)) {
    const existing = await getLeadByPhone(norm);
    if (existing) await updateLead(existing.id, { status: 'dropped', last_msg_at: new Date().toISOString() });
    return jsonResponse(res, 200, { ok: true, action: 'opt_out' });
  }

  const market = detectMarket(norm);
  let lead = await getLeadByPhone(norm);
  if (!lead) {
    lead = await upsertLead({
      phone: norm,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market
    });
    // Welcome.
    if (await canSend({ phone: norm, force: true })) {
      await sendTemplate({
        phone: norm,
        template: process.env.AISENSY_CAMPAIGN_WELCOME || 'welcome_v1',
        params: [name || 'there'],
        body: market === 'IN' ? COPY.welcome.IN : COPY.welcome.EN
      });
    }
    return jsonResponse(res, 200, { ok: true, action: 'new_lead', lead_id: lead.id });
  }

  // Update activity.
  await updateLead(lead.id, { last_msg_at: new Date().toISOString() });

  // Escalation scan first.
  const esc = escalationReason(text);
  if (esc) {
    await updateLead(lead.id, { escalated: true, escalation_reason: esc });
    const maddy = normalisePhone(process.env.MADDY_WA_NUMBER);
    if (maddy) {
      await sendText({ phone: maddy, body: COPY.escalationToMaddy(maskPhone(norm), esc, text) });
    }
    // Acknowledge gently — still within rate limit budget.
    if (await canSend({ phone: norm })) {
      await sendText({
        phone: norm,
        body: market === 'IN'
          ? "Thanks for sharing. Maddy khud aapko jawab degi — kripya thoda wait karein."
          : "Thanks for sharing — Maddy will respond personally. Please hold for a short while."
      });
    }
    return jsonResponse(res, 200, { ok: true, action: 'escalated', reason: esc });
  }

  // Keyword routing → qualified.
  const route = routeKeyword(text);
  if (route && lead.status === 'new') {
    await updateLead(lead.id, { status: 'qualified', program_interest: route.program });
    if (await canSend({ phone: norm })) {
      const copy = market === 'IN' ? COPY.route.IN : COPY.route.EN;
      await sendText({
        phone: norm,
        body: copy(name || 'there', route.price, checkoutUrl(route.checkoutSlug), intakeUrl(lead.id))
      });
    }
    return jsonResponse(res, 200, { ok: true, action: 'routed', program: route.program });
  }

  // Otherwise silent — human may step in. The 2h nudge is fired by cron.
  return jsonResponse(res, 200, { ok: true, action: 'noop' });
}

// Accept payloads from AiSensy or Meta Cloud API shapes.
function parseInbound(raw) {
  if (!raw || typeof raw !== 'object') return null;

  // AiSensy-style: { data: { phone, text, name } } OR { from, body, name }
  const aPhone = raw?.data?.phone || raw.phone || raw.from || raw.wa_id;
  const aText  = raw?.data?.text || raw.text || raw.body || raw.message;
  const aName  = raw?.data?.name || raw.name || raw.contact_name;
  if (aPhone && (aText !== undefined)) return { phone: aPhone, text: String(aText || ''), name: aName };

  // Meta Cloud API-style.
  const entry = raw.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const msg = change?.messages?.[0];
  if (msg) {
    const phone = msg.from;
    const text = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || '';
    const name = change?.contacts?.[0]?.profile?.name;
    return { phone, text, name };
  }
  return null;
}
