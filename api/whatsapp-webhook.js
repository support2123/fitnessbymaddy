const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText, logMessage } = require('./lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./lib/market');
const { needsEscalation, escalateToMaddy, classifyProgram } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.from || payload.senderMobile || '');
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logMessage(phone, 'in', text, null);

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await handleOptOut(phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Sensitive keyword detected in message', { phone, name, message: text });
      return res.json({ action: 'escalated' });
    }

    const db = getSupabase();

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.json({ action: 'dropped_lead' });
      }
      await handleReturningLead(existingLead, text, name);
      return res.json({ action: 'returning_lead', lead_id: existingLead.id });
    }

    const lead = await handleNewLead(phone, text, name);
    return res.json({ action: 'new_lead', lead_id: lead.id });

  } catch (err) {
    console.error('Webhook error:', maskPhone(req.body?.mobile || ''), err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, text, name) {
  const db = getSupabase();
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there'
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there'
    ]);
  }

  return lead;
}

async function handleReturningLead(lead, text, name) {
  const db = getSupabase();

  await db.from('leads').update({
    last_msg_at: new Date().toISOString(),
    name: name || lead.name
  }).eq('id', lead.id);

  const match = classifyProgram(text);
  if (match) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: match.program
    }).eq('id', lead.id);

    const hinglish = isHinglish(lead.market);
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

    if (hinglish) {
      await sendText(phone(lead),
        `${match.name} program — $${match.price}. Yeh raha checkout link:\n${checkoutUrl}\n\nAur yeh intake form bhi fill kardo:\n${intakeUrl}`
      );
    } else {
      await sendText(phone(lead),
        `Great choice! ${match.name} — $${match.price}. Here's your checkout link:\n${checkoutUrl}\n\nPlease also fill out your intake form:\n${intakeUrl}`
      );
    }
  }
}

function phone(lead) {
  return lead.phone;
}

async function handleOptOut(phoneNum) {
  const db = getSupabase();
  await db.from('leads').update({ status: 'dropped' }).eq('phone', phoneNum);
}

function normalizePhone(raw) {
  let cleaned = raw.replace(/[\s\-\(\)]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}
