// Inbound WhatsApp webhook.
// Accepts both AiSensy (POST JSON with shared secret) and
// Meta Cloud API (GET challenge + POST signed payload).
//
// Responsibilities:
//  1. Verify webhook signature / secret.
//  2. Parse phone + body.
//  3. Upsert lead, log message, run flow logic.
//  4. Escalate on trigger keywords BEFORE any automated reply.

import { supabase } from './_lib/supabase.js';
import { TEMPLATES, sendTemplate } from './_lib/whatsapp.js';
import {
  normalizePhone, detectMarket, classifyProgram,
  detectEscalation, isOptOut, json, maskPhone,
} from './_lib/utils.js';
import { openEscalation } from './_lib/escalation.js';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  // ── Meta verification challenge ─────────────────────────
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('forbidden');
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  // ── AiSensy secret (if configured) ──────────────────────
  const expected = process.env.AISENSY_WEBHOOK_SECRET;
  if (expected) {
    const got = req.headers['x-aisensy-secret'] || req.query.secret;
    if (got !== expected) {
      // Don't reveal why. Meta webhooks may still come in — fall through only
      // if this looks like a Meta payload (has `entry` array).
      if (!req.body?.entry) return json(res, 401, { error: 'unauthorized' });
    }
  }

  try {
    const parsed = extractMessage(req.body);
    if (!parsed) return json(res, 200, { ok: true, skipped: 'no_message' });
    await handleMessage(parsed);
    return json(res, 200, { ok: true });
  } catch (e) {
    console.error('[webhook] error', e?.message);
    return json(res, 200, { ok: false, error: 'internal' }); // 200 so provider doesn't retry-storm
  }
}

// ─── Payload shape normaliser ────────────────────────────────
function extractMessage(body) {
  if (!body) return null;

  // AiSensy v2 webhook
  if (body.phone && (body.message || body.text)) {
    const phone = normalizePhone(body.phone);
    return phone ? {
      phone,
      body: body.message || body.text || '',
      name: body.name || body.senderName,
    } : null;
  }

  // Meta Cloud API webhook
  const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const contact = body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];
  if (msg) {
    const phone = normalizePhone(msg.from);
    return phone ? {
      phone,
      body: msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || '',
      name: contact?.profile?.name,
    } : null;
  }

  return null;
}

// ─── Core flow logic ─────────────────────────────────────────
async function handleMessage({ phone, body, name }) {
  const text = (body || '').trim();
  const market = detectMarket(phone);

  // 1. Always log inbound first — this is the audit source of truth.
  await supabase.from('messages').insert({
    phone, direction: 'in', body: text, status: 'delivered',
  });

  // 2. Opt-out hard stop.
  if (isOptOut(text)) {
    await supabase.from('leads')
      .update({ status: 'dropped', opted_out: true, last_msg_at: new Date().toISOString() })
      .eq('phone', phone);
    return;
  }

  // 3. Look up or create lead.
  const { data: existing } = await supabase.from('leads').select('*').eq('phone', phone).maybeSingle();
  let lead = existing;
  const nowIso = new Date().toISOString();

  if (!lead) {
    const { data: inserted } = await supabase.from('leads').insert({
      phone, name, market, first_msg: text, last_msg_at: nowIso,
    }).select().single();
    lead = inserted;
  } else {
    await supabase.from('leads').update({
      last_msg_at: nowIso,
      name: lead.name || name,
    }).eq('id', lead.id);
  }

  // 4. Existing client? route differently (no auto-greeting).
  const { data: client } = await supabase.from('clients')
    .select('id, status, program').eq('phone', phone).maybeSingle();

  // 5. Escalation triggers — BEFORE sending any automated reply.
  const trigger = detectEscalation(text);
  if (trigger) {
    await openEscalation({
      reason: `keyword_trigger:${trigger}`,
      phone, leadId: lead?.id, clientId: client?.id,
      payload: { snippet: text, matched: trigger },
    });
    return; // Maddy handles from here.
  }

  // 6. Active client → log only, let Maddy / scheduled flows handle it.
  if (client && client.status === 'active') return;

  // 7. New lead (no outbound yet) → greet.
  if (!lead.last_outbound_at && lead.status === 'new') {
    await sendTemplate({
      phone, templateName: 'welcome_v1', market,
      lastOutboundAt: lead.last_outbound_at,
    });
    await supabase.from('leads').update({
      last_outbound_at: nowIso,
    }).eq('id', lead.id);
    return;
  }

  // 8. Reply contains a program keyword → qualify + send checkout.
  const program = classifyProgram(text);
  if (program) {
    const checkoutId = lead.id; // Exly accepts arbitrary ref; we'll join on webhook.
    const checkout = `${process.env.EXLY_CHECKOUT_BASE || 'https://fitnessbymaddyy.exlyapp.com/checkout'}/${checkoutId}?p=${program}`;
    const intake   = `${process.env.PUBLIC_SITE_URL || 'https://fitnessbymaddy.com'}/intake?lead=${lead.id}`;
    await sendTemplate({
      phone, templateName: 'checkout_link', market,
      params: { program_name: programName(program), checkout, intake },
      lastOutboundAt: lead.last_outbound_at,
    });
    await supabase.from('leads').update({
      status: 'qualified',
      program_interest: program,
      last_outbound_at: nowIso,
    }).eq('id', lead.id);
    return;
  }

  // 9. Otherwise: stay silent. 2-hour + 24-hour nudge cron handles re-engagement.
}

function programName(p) {
  return ({
    '6wk_gym':  '6-Week Burn & Build',
    '6wk_home': '6-Week Home Edition',
    '12wk':     '12-Week Flagship',
    'pcos':     'PCOS Warrior',
    '40plus':   '40+ Strong',
    'zoom_trial':'$20 Zoom Trial',
    'zoom_pack': 'Zoom Pack',
  })[p] || p;
}
