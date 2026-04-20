const { getClient } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { KEYWORD_ROUTES, PROGRAMS } = require('../lib/constants');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.senderPhone || payload.waId || payload.from);
    const text = (payload.text || payload.body || payload.message || '').trim();
    const name = payload.senderName || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getClient();
    const market = detectMarket(phone);

    await logMessage(phone, 'in', text, null);

    // Opt-out check
    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.json({ action: 'opted_out' });
    }

    // Escalation check
    if (needsEscalation(text)) {
      await escalateToMaddy(phone, 'Keyword trigger in message', text);
    }

    // Check if existing lead
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    // Check if existing client
    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    // Active client — pass through (human support or future AI chat)
    if (existingClient) {
      return res.json({ action: 'client_message_logged', client_id: existingClient.id });
    }

    // Existing lead — try qualification
    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.json({ action: 'lead_dropped_ignored' });
      }

      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

      const route = matchProgram(text);
      if (route) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: route,
        }).eq('id', existingLead.id);

        const prog = PROGRAMS[route];
        const hinglish = isHinglish(market);

        const checkoutMsg = hinglish
          ? `Great choice! 🔥 ${prog.name} — ${prog.price} USD.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${route}\n\nIntake form bhi fill karo: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`
          : `Great choice! 🔥 ${prog.name} — $${prog.price}.\n\nCheckout here: https://fitnessbymaddyy.exlyapp.com/checkout/${route}\n\nPlease also fill the intake form: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        await sendText(phone, checkoutMsg);
        return res.json({ action: 'qualified', program: route });
      }

      return res.json({ action: 'lead_message_logged' });
    }

    // New lead
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: text?.substring(0, 500),
      last_msg_at: new Date().toISOString(),
      market,
    }).select().single();

    // Send welcome
    await sendTemplate(phone, 'welcome_v1', {
      name: name || 'there',
      templateParams: [name || 'there'],
    });

    // Schedule nudge (2hr) — handled by checking last_msg_at in cron
    // Schedule drop (24hr) — handled by nudge-dropped cron

    // Try to qualify immediately if message has keywords
    const route = matchProgram(text);
    if (route && newLead) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: route,
      }).eq('id', newLead.id);
    }

    return res.json({ action: 'new_lead', lead_id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.replace(/[\s\-()]/g, '');
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of KEYWORD_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route.program;
    }
  }
  return null;
}
