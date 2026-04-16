// AiSensy incoming-message webhook.
// Flow A: new lead → greet. Flow B: qualify + route to checkout.
// Handles opt-out, escalation, rate-limits, and kicks the 2h nudge via scheduled follow-up.

import { db, logMessage } from '../lib/supabase.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { normalizePhone, maskPhone } from '../lib/pii.js';
import { detectMarket, copyFor } from '../lib/lang.js';
import { routeFromText, checkoutUrl, intakeUrl, PROGRAM_CATALOG } from '../lib/routing.js';
import { detectEscalation, isOptOut, raiseEscalation } from '../lib/escalation.js';
import { json, readBody } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const body = await readBody(req);

  // AiSensy delivery / status callbacks — acknowledge and drop.
  if (body?.eventType && body.eventType !== 'message') {
    return json(res, 200, { ok: true, ignored: body.eventType });
  }

  const phone = normalizePhone(body?.from || body?.phone || body?.mobile || body?.waId);
  const text = (body?.text || body?.message || body?.body || '').toString().trim();
  const name = body?.name || body?.profileName || null;

  if (!phone) return json(res, 200, { ok: true, ignored: 'no_phone' });

  try {
    await logMessage({
      phone,
      direction: 'in',
      body: text,
      meta: { source: body?.source || 'aisensy', name: name || null }
    });

    // 1. Opt-out.
    if (isOptOut(text)) {
      await upsertLead({ phone, name, firstMsg: text, status: 'dropped' });
      return json(res, 200, { ok: true, action: 'opt_out' });
    }

    // 2. Escalation keywords → flag + acknowledge.
    const escalation = detectEscalation(text);
    const market = detectMarket(phone);
    const lead = await upsertLead({ phone, name, firstMsg: text });

    if (escalation) {
      await raiseEscalation({
        phone, lead_id: lead.id, reason: escalation, context: text
      });
      await sendWhatsApp({
        phone,
        body: copyFor('escalation_ack', market),
        templateName: 'escalation_ack',
        campaignName: 'escalation_ack',
        params: [],
        force: true
      });
      return json(res, 200, { ok: true, action: 'escalated', reason: escalation });
    }

    // 3. First-time lead → welcome.
    if (!lead._existed) {
      await sendWhatsApp({
        phone,
        body: copyFor('welcome_v1', market),
        templateName: 'welcome_v1',
        campaignName: 'welcome_v1',
        params: [],
        force: true
      });
      return json(res, 200, { ok: true, action: 'welcomed' });
    }

    // 4. Qualify: match program keyword → send checkout + intake link.
    const program = routeFromText(text);
    if (program) {
      const catalog = PROGRAM_CATALOG[program];
      await db().from('leads')
        .update({ program_interest: program, status: 'qualified', last_msg_at: new Date().toISOString() })
        .eq('id', lead.id);

      const link = checkoutUrl(program, null);
      const intake = intakeUrl(lead.id);
      const msg = copyFor('checkout_link', market, { link, intake });
      await sendWhatsApp({
        phone,
        body: msg,
        templateName: 'checkout_link',
        campaignName: `checkout_${program}`,
        params: [catalog.label, `$${catalog.price_usd}`, link]
      });
      return json(res, 200, { ok: true, action: 'qualified', program });
    }

    // 5. Generic follow-up: nudge with trial.
    const link = checkoutUrl('zoom_trial', null);
    await sendWhatsApp({
      phone,
      body: copyFor('nudge_trial', market, { link }),
      templateName: 'nudge_trial',
      campaignName: 'nudge_trial',
      params: [link]
    });
    return json(res, 200, { ok: true, action: 'nudged' });
  } catch (err) {
    console.error(`[whatsapp-webhook] ${maskPhone(phone)} error`, err?.message);
    return json(res, 200, { ok: false, error: 'internal' });
  }
}

async function upsertLead({ phone, name, firstMsg, status }) {
  const sb = db();
  const market = detectMarket(phone);
  const { data: existing } = await sb.from('leads').select('*').eq('phone', phone).maybeSingle();

  if (existing) {
    const patch = { last_msg_at: new Date().toISOString() };
    if (name && !existing.name) patch.name = name;
    if (status) patch.status = status;
    await sb.from('leads').update(patch).eq('id', existing.id);
    return { ...existing, ...patch, _existed: true };
  }

  const { data: created } = await sb.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: status || 'new',
    first_msg: firstMsg ? firstMsg.slice(0, 500) : null,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();
  return { ...created, _existed: false };
}
