const { supabase } = require('../lib/supabase');
const { sendRateLimited, sendTemplate, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, getEscalationReason, escalateToMaddy, isOptOut } = require('../lib/escalation');
const { matchProgram } = require('../lib/keywords');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.sender;
    const messageBody = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    await logMessage(phone, 'in', messageBody);

    if (isOptOut(messageBody)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageBody)) {
      const reasons = getEscalationReason(messageBody);
      await escalateToMaddy(phone, reasons.join(', '), messageBody);
      const market = detectMarket(phone);
      const reply = isHinglish(market)
        ? 'Aapka message Maddy tak pahuncha diya hai. Woh jaldi se respond karengi.'
        : 'Your message has been forwarded to Maddy. She will respond shortly.';
      await sendTemplate(phone, 'escalation_ack', [reply]);
      return res.status(200).json({ action: 'escalated', reasons });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'client_message_logged' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .maybeSingle();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead_ignored' });
      }
      return await handleExistingLead(existingLead, messageBody, phone, res);
    }

    return await handleNewLead(phone, name, messageBody, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function handleNewLead(phone, name, messageBody, res) {
  const market = detectMarket(phone);

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: messageBody,
      last_msg_at: new Date().toISOString(),
      market,
    })
    .select()
    .single();

  if (error) {
    console.error('Insert lead error:', error.message);
    return res.status(500).json({ error: 'Failed to create lead' });
  }

  const welcomeParams = isHinglish(market)
    ? ["Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"]
    : ["Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"];

  await sendTemplate(phone, 'welcome_v1', welcomeParams);

  return res.status(200).json({ action: 'new_lead_created', leadId: lead.id });
}

async function handleExistingLead(lead, messageBody, phone, res) {
  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const program = matchProgram(messageBody);
  if (!program) {
    return res.status(200).json({ action: 'lead_message_logged', noMatch: true });
  }

  await supabase
    .from('leads')
    .update({ status: 'qualified', program_interest: program.program })
    .eq('id', lead.id);

  const market = detectMarket(phone);
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program.checkoutPath}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const params = isHinglish(market)
    ? [program.name, `$${program.price}`, checkoutUrl, intakeUrl]
    : [program.name, `$${program.price}`, checkoutUrl, intakeUrl];

  await sendRateLimited(phone, 'program_qualified', params);

  return res.status(200).json({
    action: 'lead_qualified',
    program: program.program,
    leadId: lead.id,
  });
}

async function handleOptOut(phone) {
  await supabase
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);

  await supabase
    .from('clients')
    .update({ status: 'paused' })
    .eq('phone', phone)
    .eq('status', 'active');
}
