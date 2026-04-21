const { supabase } = require('./_lib/supabase');
const { sendTemplate, detectMarket, maskPhone } = require('./_lib/whatsapp');
const { qualifyLead, getCheckoutUrl } = require('./_lib/qualify');
const { needsEscalation, createEscalation } = require('./_lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.from || payload.senderPhone || '');
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    // Log inbound message
    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    // Check opt-out
    if (isOptOut(message)) {
      await supabase.from('leads').update({ opted_out: true, status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out processed: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check escalation triggers
    if (needsEscalation(message)) {
      await createEscalation(phone, 'keyword_trigger', message);
      return res.status(200).json({ action: 'escalated' });
    }

    // Check if existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      // FLOW A: New lead
      return await handleNewLead(phone, name, message, res);
    }

    // Existing lead — update last message
    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'new') {
      // FLOW B: Qualify based on reply
      return await handleQualification(phone, existingLead, message, res);
    }

    // Already qualified or converted — no auto-reply needed
    return res.status(200).json({ action: 'noted', status: existingLead.status });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, name, message, res) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  });

  // Send welcome template
  const templateName = market === 'IN' ? 'welcome_v1_hindi' : 'welcome_v1';
  await sendTemplate(phone, templateName, [name || 'there']);

  // Schedule nudge at 2 hours (handled by cron checking last_msg_at)
  return res.status(200).json({ action: 'new_lead_welcomed', market });
}

async function handleQualification(phone, lead, message, res) {
  const route = qualifyLead(message);

  if (!route) {
    // Can't determine intent — send clarification
    const market = lead.market || detectMarket(phone);
    const template = market === 'IN' ? 'clarify_goal_hindi' : 'clarify_goal';
    await sendTemplate(phone, template, [lead.name || 'there']);
    return res.status(200).json({ action: 'clarification_sent' });
  }

  // Update lead with program interest
  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: route.program
  }).eq('phone', phone);

  // Send checkout + intake form links
  const checkoutUrl = getCheckoutUrl(route);
  const intakeUrl = `${process.env.APP_URL || 'https://fitnessbymaddy.com'}/intake?lead=${lead.id}`;

  const market = lead.market || 'IN';
  const templateName = market === 'IN' ? 'program_offer_hindi' : 'program_offer';

  await sendTemplate(phone, templateName, [
    lead.name || 'there',
    route.name,
    `$${route.price}`,
    checkoutUrl,
    intakeUrl
  ]);

  return res.status(200).json({ action: 'qualified', program: route.program });
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  if (cleaned.startsWith('0')) cleaned = '91' + cleaned.slice(1);
  return cleaned;
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}
