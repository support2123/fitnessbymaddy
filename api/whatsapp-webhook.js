const { supabase } = require('../lib/supabase');
const { sendTemplate, logIncoming, canSendMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, escalate } = require('../lib/escalation');
const { matchProgram } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone || !message) return res.status(400).json({ error: 'Missing phone or message' });

    await logIncoming(phone, message);

    if (isOptOut(message)) {
      await supabase().from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationReason = needsEscalation(message);
    if (escalationReason) {
      await escalate(phone, escalationReason, message);
    }

    const { data: existingLead } = await supabase()
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead && existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    const market = detectMarket(phone);

    if (!existingLead) {
      await handleNewLead(phone, name, message, market);
      return res.status(200).json({ action: 'new_lead_created' });
    }

    await supabase()
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      await handleQualification(existingLead, message, market);
      return res.status(200).json({ action: 'lead_qualified' });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, name, message, market) {
  const { data: lead } = await supabase().from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    market,
  }).select().single();

  const hinglish = isHinglish(market);

  if (await canSendMessage(phone, false)) {
    if (hinglish) {
      await sendTemplate(phone, 'welcome_v1_hi', [name || 'there']);
    } else {
      await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
    }
  }

  return lead;
}

async function handleQualification(lead, message, market) {
  const matched = matchProgram(message);
  if (!matched) return;

  await supabase().from('leads').update({
    status: 'qualified',
    program_interest: matched.program,
  }).eq('id', lead.id);

  const hinglish = isHinglish(market);

  if (await canSendMessage(lead.phone, false)) {
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

    await sendTemplate(lead.phone, 'program_match', [
      lead.name || 'there',
      matched.name,
      `$${matched.price}`,
      checkoutUrl,
      intakeUrl,
    ]);
  }
}

function parseWebhookPayload(body) {
  if (!body) return {};
  if (body.phone && body.message) return body;
  if (body.entry) {
    const changes = body.entry?.[0]?.changes?.[0]?.value;
    const msg = changes?.messages?.[0];
    const contact = changes?.contacts?.[0];
    return {
      phone: msg?.from || '',
      message: msg?.text?.body || '',
      name: contact?.profile?.name || '',
    };
  }
  if (body.response) {
    return {
      phone: body.response?.from || body.destination || '',
      message: body.response?.text || body.message || '',
      name: body.response?.name || '',
    };
  }
  return {};
}
