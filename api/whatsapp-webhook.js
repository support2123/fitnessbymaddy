// AiSensy / Meta Cloud API webhook for incoming WhatsApp messages.
// Flow A: greet new leads.
// Flow B: qualify intent + send checkout / intake links.
// Also handles STOP (opt-out) and human-escalation keywords.
import { db } from './_lib/supabase.js';
import { sendWhatsApp, logMessage } from './_lib/whatsapp.js';
import { template } from './_lib/templates.js';
import { marketForPhone } from './_lib/market.js';
import { detectEscalation, escalate } from './_lib/escalation.js';
import { routeMessage, templateForProgram } from './_lib/router.js';
import { checkoutUrl, intakeUrl, trialUrl } from './_lib/checkout.js';
import { normalisePhone, ok, bad, readJson, maskPhone } from './_lib/util.js';

export default async function handler(req, res) {
  // Meta verification handshake.
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.META_WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('forbidden');
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const body = await readJson(req);
  const inbound = parseInbound(body);
  if (!inbound) return res.status(200).json({ ok: true, ignored: true });

  const phone = normalisePhone(inbound.from);
  const text = (inbound.text || '').trim();
  const market = marketForPhone(phone);

  await logMessage({ phone, direction: 'in', body: text, meta: { raw: inbound.raw } });

  const supa = db();

  // --- Upsert lead ---
  const { data: existing } = await supa
    .from('leads').select('*').eq('phone', phone).maybeSingle();

  let lead = existing;
  if (!lead) {
    const ins = await supa.from('leads').insert({
      phone, name: inbound.name || null, source: 'whatsapp',
      first_msg: text.slice(0, 500), last_msg_at: new Date().toISOString(),
      market,
    }).select().single();
    lead = ins.data;
  } else {
    await supa.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: lead.name || inbound.name || null,
    }).eq('id', lead.id);
  }

  // --- Opt-out & escalation FIRST ---
  if (/\b(stop|unsubscribe|opt[\s-]?out)\b/i.test(text)) {
    await supa.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
    return res.status(200).json({ ok: true, action: 'opt_out' });
  }

  const trigger = detectEscalation(text);
  if (trigger) {
    await escalate({ phone, leadId: lead.id, trigger, context: text });
    // Send a holding reply (not a hard "no").
    await sendWhatsApp({
      phone,
      body: market === 'IN'
        ? "Thanks for sharing. Maddy ko forward kar diya — woh personally reply karegi. 🙏"
        : "Thanks for sharing — flagging this with Maddy directly. She'll personally reply. 🙏",
      meta: { kind: 'escalation_ack' },
    });
    return res.status(200).json({ ok: true, action: 'escalated', trigger });
  }

  // --- Routing ---
  const route = routeMessage(text);

  // Brand new lead, no clear intent yet → welcome template.
  if (!existing && route.intent === 'unknown') {
    const t = template('welcome_v1', market);
    await sendWhatsApp({ phone, body: t.body, templateName: t.name, bypassRateLimit: true });
    return res.status(200).json({ ok: true, action: 'welcomed' });
  }

  // Qualified intent → send program offer.
  if (route.program) {
    const tplName = templateForProgram(route.program);
    const t = template(tplName, market, {
      checkout_url: checkoutUrl(route.program, lead.id),
      intake_url:   intakeUrl(lead.id),
    });
    await sendWhatsApp({ phone, body: t.body, templateName: t.name });
    await supa.from('leads').update({
      status: 'qualified',
      program_interest: route.program,
    }).eq('id', lead.id);
    return res.status(200).json({ ok: true, action: 'qualified', program: route.program });
  }

  // Existing lead, unclear text → re-ask welcome (rate-limited).
  if (route.intent === 'unknown') {
    const t = template('welcome_v1', market);
    await sendWhatsApp({ phone, body: t.body, templateName: t.name });
    return res.status(200).json({ ok: true, action: 're-prompted' });
  }

  return res.status(200).json({ ok: true });
}

// Normalise AiSensy + Meta payloads into one shape.
function parseInbound(body) {
  if (!body) return null;

  // Meta Cloud API
  if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const v = body.entry[0].changes[0].value;
    const msg = v.messages[0];
    const contact = v.contacts?.[0];
    return {
      from: msg.from,
      text: msg.text?.body || msg.button?.text || msg.interactive?.list_reply?.title || '',
      name: contact?.profile?.name || null,
      raw: msg,
    };
  }
  // AiSensy webhook (text + sender are typical fields)
  if (body.from || body.sender || body.userPhone) {
    return {
      from: body.from || body.sender || body.userPhone,
      text: body.text || body.body || body.message || '',
      name: body.name || body.userName || null,
      raw: body,
    };
  }
  return null;
}
