// Inbound WhatsApp webhook (AiSensy primary, Meta fallback).
//
// Handles:
//  Flow A — new lead: insert, send welcome_v1 reply
//  Flow B — qualification: keyword route → checkout + intake link
//  Opt-out: STOP / unsubscribe
//  Escalation: red-flag keywords → notify Maddy
//  Meta verification (GET with hub.challenge)

const { admin } = require('./_lib/supabase');
const { sendText, logMessage } = require('./_lib/aisensy');
const { readJson, ok, err, normalisePhone, marketFromPhone, maskPhone } = require('./_lib/utils');
const { routeFromText, checkoutUrl, intakeUrl, trialUrl } = require('./_lib/router');
const { welcomeBody, nudgeTrialBody, campaign } = require('./_lib/templates');
const escalation = require('./_lib/escalation');

module.exports = async (req, res) => {
  // Meta Cloud API webhook verification
  if (req.method === 'GET') {
    const mode = req.query?.['hub.mode'];
    const token = req.query?.['hub.verify_token'];
    const challenge = req.query?.['hub.challenge'];
    if (mode === 'subscribe' && token && token === process.env.META_VERIFY_TOKEN) {
      res.statusCode = 200;
      return res.end(String(challenge || ''));
    }
    return err(res, 403, 'forbidden');
  }

  if (req.method !== 'POST') return err(res, 405, 'method_not_allowed');

  const body = await readJson(req);

  // Normalise inbound payload across AiSensy and Meta
  const inbound = parseInbound(body);
  if (!inbound) {
    // Acknowledge to prevent retries on unknown payloads
    return ok(res, { ignored: true });
  }

  const phone = normalisePhone(inbound.from);
  if (!phone) return ok(res, { ignored: true, reason: 'bad_phone' });
  const text = (inbound.text || '').trim();

  await logMessage({ phone, direction: 'in', body: text, template: null, status: 'received' });

  // Opt-out
  if (/^\s*(stop|unsubscribe|opt\s*out|band\s*karo)\s*$/i.test(text)) {
    await optOut(phone);
    return ok(res, { handled: 'opted_out' });
  }

  const sb = admin();
  const market = marketFromPhone(phone);

  // Find or create lead
  let lead = await findLead(sb, phone);
  const isNew = !lead;
  if (isNew) {
    const ins = await sb.from('leads').insert({
      phone, market, status: 'new',
      first_msg: text.slice(0, 500), last_msg_at: new Date().toISOString(),
      name: inbound.name || null,
      source: inbound.source || 'whatsapp',
    }).select().single();
    if (ins.error) {
      console.error(`[lead-insert-fail] ${maskPhone(phone)} ${ins.error.message}`);
      return err(res, 500, 'lead_insert_failed');
    }
    lead = ins.data;
  } else {
    await sb.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: lead.name || inbound.name || null,
    }).eq('id', lead.id);
  }

  // Escalation check on every inbound message
  const redFlag = escalation.detect(text);
  if (redFlag) {
    await escalation.raise({
      phone, leadId: lead.id, trigger: redFlag, detail: text.slice(0, 500),
    });
    await escalation.notifyMaddy({ trigger: redFlag, phone: maskPhone(phone), detail: text.slice(0, 300) });
    // Soft acknowledgement to the user; do NOT auto-advise on medical matters
    const ackBody = market === 'IN'
      ? 'Message mil gaya 🙏 Maddy khud reply karengi jaldi — yeh human review ke liye bheja hai.'
      : 'Got your message 🙏 Maddy will reply personally — flagged for human review.';
    await sendText({ to: phone, body: ackBody, campaignName: campaign('welcome'), templateParams: [ackBody], bypassRateLimit: true });
    return ok(res, { handled: 'escalated', reason: redFlag });
  }

  // Flow A — new lead welcome
  if (isNew) {
    const wbody = welcomeBody(market);
    await sendText({
      to: phone, body: wbody,
      campaignName: campaign('welcome'),
      userName: lead.name || 'there',
      templateParams: [wbody],
    });
    return ok(res, { handled: 'welcomed', lead_id: lead.id });
  }

  // Flow B — keyword-based qualification on any reply while status=new
  if (lead.status === 'new' || lead.status === 'qualified') {
    const route = routeFromText(text);
    if (route) {
      await sb.from('leads').update({
        status: 'qualified',
        program_interest: route.program,
      }).eq('id', lead.id);

      const co = checkoutUrl(route.checkoutId);
      const ink = intakeUrl(lead.id);
      const msg = market === 'IN'
        ? `Perfect! ${programLabel(route.program)} aapke liye best fit lag raha hai.\nCheckout: ${co || '[link soon]'}\nIntake form (2 min): ${ink}`
        : `Great! ${programLabel(route.program)} looks like the best fit for you.\nCheckout: ${co || '[link soon]'}\nIntake form (2 min): ${ink}`;
      await sendText({
        to: phone, body: msg,
        campaignName: campaign('welcome'),
        userName: lead.name || 'there',
        templateParams: [msg],
      });
      return ok(res, { handled: 'routed', program: route.program, lead_id: lead.id });
    }
  }

  // Fallback — no match, gentle nudge toward the trial
  const nb = nudgeTrialBody(market, trialUrl() || 'https://fitnessbymaddy.com');
  await sendText({
    to: phone, body: nb,
    campaignName: campaign('nudge_trial') || campaign('welcome'),
    userName: lead.name || 'there',
    templateParams: [nb],
  });
  return ok(res, { handled: 'fallback', lead_id: lead.id });
};

// ---- helpers ----

function parseInbound(body) {
  if (!body || typeof body !== 'object') return null;

  // AiSensy shape (simplified):
  // { type: 'incoming', data: { from, text, contact_name, source } } OR { sender, message }
  if (body.type === 'incoming' && body.data) {
    return {
      from: body.data.from || body.data.phone || body.data.mobile,
      text: body.data.text || body.data.message,
      name: body.data.contact_name || body.data.name,
      source: body.data.source || 'aisensy',
    };
  }
  if (body.sender && body.message) {
    return { from: body.sender, text: body.message, name: body.name, source: 'aisensy' };
  }

  // Meta Cloud API shape
  const entry = body.entry?.[0]?.changes?.[0]?.value;
  const m = entry?.messages?.[0];
  if (m) {
    return {
      from: m.from,
      text: m.text?.body || m.button?.text || m.interactive?.button_reply?.title || '',
      name: entry.contacts?.[0]?.profile?.name,
      source: 'meta',
    };
  }

  return null;
}

async function findLead(sb, phone) {
  const { data } = await sb.from('leads').select('*').eq('phone', phone).maybeSingle();
  return data || null;
}

async function optOut(phone) {
  const sb = admin();
  await sb.from('leads').update({ opted_out: true, status: 'dropped' }).eq('phone', phone);
}

function programLabel(p) {
  return {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': '$20 Zoom Trial',
    'zoom_pack': 'Zoom Coaching Pack',
  }[p] || p;
}
