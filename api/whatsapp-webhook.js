const { getClient } = require('../lib/supabase');
const { sendTemplate, maskPhone, detectMarket } = require('../lib/whatsapp');
const { logMessage, isOptedOut } = require('../lib/messages');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { routeToProgram, getCheckoutUrl, getIntakeUrl } = require('../lib/program-router');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.senderMobile || payload.from;
    const messageText = payload.message || payload.text || payload.body || '';
    const senderName = payload.senderName || payload.name || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const cleanPhone = phone.replace(/[^0-9]/g, '');
    await logMessage(cleanPhone, 'in', messageText);

    if (await isOptedOut(cleanPhone)) {
      return res.status(200).json({ status: 'opted_out' });
    }

    const lower = messageText.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await handleOptOut(cleanPhone);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      await escalateToMaddy('Sensitive keyword detected in message', {
        phone: cleanPhone,
        name: senderName,
        message: messageText,
      });
    }

    const sb = getClient();
    const { data: existingLead } = await sb
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .limit(1)
      .single();

    const { data: existingClient } = await sb
      .from('clients')
      .select('*')
      .eq('phone', cleanPhone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      await logMessage(cleanPhone, 'out', '[Active client reply — routed to support]');
      return res.status(200).json({ status: 'active_client' });
    }

    if (!existingLead) {
      return await handleNewLead(sb, cleanPhone, senderName, messageText, res);
    }

    if (existingLead.status === 'new') {
      return await handleLeadReply(sb, existingLead, messageText, res);
    }

    return res.status(200).json({ status: 'acknowledged' });
  } catch (err) {
    console.error('[WA_WEBHOOK]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(sb, phone, name, message, res) {
  const market = detectMarket(phone);
  const { data: lead, error } = await sb
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message.slice(0, 500),
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('[NEW_LEAD]', error.message);
    return res.status(500).json({ error: 'Failed to create lead' });
  }

  const isHinglish = market === 'IN';
  const welcomeTemplate = isHinglish ? 'welcome_v1_hi' : 'welcome_v1';
  await sendTemplate(phone, welcomeTemplate, [name || 'there']);
  await logMessage(phone, 'out', 'Welcome message sent', welcomeTemplate);

  return res.status(200).json({ status: 'new_lead', id: lead.id });
}

async function handleLeadReply(sb, lead, message, res) {
  const program = routeToProgram(message);

  await sb.from('leads').update({
    last_msg_at: new Date().toISOString(),
    status: program ? 'qualified' : 'new',
    program_interest: program ? program.program : lead.program_interest,
  }).eq('id', lead.id);

  if (program) {
    const isHinglish = lead.market === 'IN';
    const checkoutUrl = getCheckoutUrl(lead.id);
    const intakeUrl = getIntakeUrl(lead.id);

    const params = [
      lead.name || 'there',
      program.name,
      `$${program.price}`,
      checkoutUrl,
      intakeUrl,
    ];
    await sendTemplate(lead.phone, 'program_offer', params);
    await logMessage(lead.phone, 'out', `Offered ${program.name} at $${program.price}`, 'program_offer');
  }

  return res.status(200).json({ status: 'lead_updated', program: program?.program || null });
}

async function handleOptOut(phone) {
  const sb = getClient();
  await sb.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  console.log(`[OPT_OUT] ${maskPhone(phone)} opted out`);
}
