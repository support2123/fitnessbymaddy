const { insertLead, getLeadByPhone, updateLead, logMessage } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglishMarket, routeByKeywords, needsEscalation, isOptOut } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.senderPhone;
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await logMessage({
      phone,
      direction: 'in',
      body: message,
      template_name: null,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOut(message)) {
      const existingLead = await getLeadByPhone(phone);
      if (existingLead) {
        await updateLead(existingLead.id, { status: 'dropped' });
      }
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Sensitive keyword detected', { phone, name, message });
    }

    const existingLead = await getLeadByPhone(phone);

    if (!existingLead) {
      return await handleNewLead(phone, name, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    return await handleReturningLead(existingLead, message, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, name, message, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglishMarket(market);

  const lead = await insertLead({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    program_interest: null,
    market,
  });

  const route = routeByKeywords(message);
  if (route) {
    await updateLead(lead.id, {
      status: 'qualified',
      program_interest: route.program,
    });
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;
    const params = [name || 'there', route.name, `$${route.price}`, checkoutUrl, intakeUrl];
    await sendTemplate(phone, 'program_offer', params);
    return res.status(200).json({ action: 'qualified', program: route.program });
  }

  const welcomeParams = hinglish
    ? [name || 'there']
    : [name || 'there'];
  await sendTemplate(phone, 'welcome_v1', welcomeParams);

  return res.status(200).json({ action: 'welcomed', lead_id: lead.id });
}

async function handleReturningLead(lead, message, res) {
  await updateLead(lead.id, { last_msg_at: new Date().toISOString() });

  if (lead.status === 'new' || lead.status === 'qualified') {
    const route = routeByKeywords(message);
    if (route) {
      await updateLead(lead.id, {
        status: 'qualified',
        program_interest: route.program,
      });
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;
      const params = [lead.name || 'there', route.name, `$${route.price}`, checkoutUrl, intakeUrl];
      await sendTemplate(lead.phone, 'program_offer', params);
      return res.status(200).json({ action: 'qualified', program: route.program });
    }
  }

  return res.status(200).json({ action: 'logged' });
}
