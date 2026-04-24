const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead, buildCheckoutUrl, buildIntakeUrl } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();

  try {
    const payload = req.body;
    const phone = extractPhone(payload);
    const text = extractText(payload);
    const name = extractName(payload);

    if (!phone) {
      return res.status(400).json({ error: 'No phone number found' });
    }

    await supabase.from('messages').insert({
      phone: maskPhone(phone),
      direction: 'in',
      body: (text || '').substring(0, 500),
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOut(text)) {
      await handleOptOut(phone, supabase);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy(
        'Keyword trigger in WhatsApp message',
        `Phone: ${maskPhone(phone)}\nMessage: ${(text || '').substring(0, 200)}`,
        { supabase }
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!existingLead || existingLead.length === 0) {
      return await handleNewLead(phone, name, text, supabase, res);
    }

    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (lead.status === 'new') {
      return await handleQualification(lead, text, supabase, res);
    }

    return res.status(200).json({ action: 'existing_lead', status: lead.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, name, text, supabase, res) {
  const market = detectMarket(phone);

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      phone,
      name: name || 'Unknown',
      source: 'whatsapp',
      status: 'new',
      first_msg: (text || '').substring(0, 500),
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('Insert lead error:', error.message);
    return res.status(500).json({ error: 'Failed to save lead' });
  }

  const hinglish = isHinglish(market);
  if (hinglish) {
    await sendTemplate(phone, 'welcome_v1', [name || 'there'], { supabase });
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there'], { supabase });
  }

  const qualification = qualifyLead(text);
  if (qualification) {
    return await routeToProgram(lead, qualification, supabase, res);
  }

  return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
}

async function handleQualification(lead, text, supabase, res) {
  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const qualification = qualifyLead(text);
  if (!qualification) {
    return res.status(200).json({ action: 'unqualified_reply' });
  }

  return await routeToProgram(lead, qualification, supabase, res);
}

async function routeToProgram(lead, qualification, supabase, res) {
  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: qualification.program,
    })
    .eq('id', lead.id);

  const market = detectMarket(lead.phone);
  const hinglish = isHinglish(market);
  const checkoutUrl = buildCheckoutUrl(lead.id);
  const intakeUrl = buildIntakeUrl(lead.id);

  let msg;
  if (hinglish) {
    msg =
      `${qualification.name} — bilkul sahi choice!\n\n` +
      `Price: $${qualification.price}\n` +
      `Checkout: ${checkoutUrl}\n\n` +
      `Payment ke baad ye form bhar do:\n${intakeUrl}\n\n` +
      `Koi sawaal ho toh poochho!`;
  } else {
    msg =
      `Great choice — ${qualification.name}!\n\n` +
      `Price: $${qualification.price}\n` +
      `Checkout: ${checkoutUrl}\n\n` +
      `After payment, fill out your intake form:\n${intakeUrl}\n\n` +
      `Any questions? Just ask!`;
  }

  await sendText(lead.phone, msg, { supabase });

  return res.status(200).json({
    action: 'qualified',
    program: qualification.program,
    lead_id: lead.id,
  });
}

async function handleOptOut(phone, supabase) {
  await supabase
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

function extractPhone(payload) {
  if (payload.phone) return payload.phone;
  if (payload.destination) return payload.destination;
  if (payload.contacts && payload.contacts[0]) return payload.contacts[0].wa_id;
  if (payload.entry && payload.entry[0]) {
    const changes = payload.entry[0].changes;
    if (changes && changes[0] && changes[0].value && changes[0].value.messages) {
      return changes[0].value.messages[0].from;
    }
  }
  return null;
}

function extractText(payload) {
  if (payload.text) return payload.text;
  if (payload.message) return payload.message;
  if (payload.entry && payload.entry[0]) {
    const changes = payload.entry[0].changes;
    if (changes && changes[0] && changes[0].value && changes[0].value.messages) {
      const msg = changes[0].value.messages[0];
      return msg.text ? msg.text.body : '';
    }
  }
  return '';
}

function extractName(payload) {
  if (payload.name) return payload.name;
  if (payload.contacts && payload.contacts[0]) return payload.contacts[0].profile?.name;
  if (payload.entry && payload.entry[0]) {
    const changes = payload.entry[0].changes;
    if (changes && changes[0] && changes[0].value && changes[0].value.contacts) {
      return changes[0].value.contacts[0].profile?.name;
    }
  }
  return null;
}
