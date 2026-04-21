const { supabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');
const { detectMarket, detectProgram, needsEscalation, isOptOut, PROGRAM_DETAILS, cors, parseBody } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const phone = body.mobile || body.from || body.sender?.phone;
    const message = body.text || body.message?.text || body.body || '';
    const name = body.name || body.sender?.name || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message, sent_at: new Date().toISOString(), status: 'received',
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await supabase.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Sensitive keyword detected', { phone, name, message });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, name, message, res);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client_reply', client_id: existingClient.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    return await handleLeadReply(existingLead, message, res);

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, name, message, res) {
  const market = detectMarket(phone);

  const { data: lead, error } = await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market,
    created_at: new Date().toISOString(),
  }).select().single();

  if (error) {
    console.error('Insert lead error:', error.message);
    return res.status(500).json({ error: 'Failed to create lead' });
  }

  const welcomeParams = market === 'IN'
    ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
    : ['Hi! Welcome to Fitness by Maddy 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

  await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

  const program = detectProgram(message);
  if (program) {
    await handleProgramMatch(lead, program, res);
    return;
  }

  return res.status(200).json({ action: 'new_lead_welcomed', lead_id: lead.id });
}

async function handleLeadReply(lead, message, res) {
  await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

  const program = detectProgram(message);
  if (!program) {
    return res.status(200).json({ action: 'no_program_match', lead_id: lead.id });
  }

  return await handleProgramMatch(lead, program, res);
}

async function handleProgramMatch(lead, program, res) {
  const details = PROGRAM_DETAILS[program];
  if (!details) return res.status(200).json({ action: 'unknown_program' });

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: program,
  }).eq('id', lead.id);

  const market = lead.market || detectMarket(lead.phone);
  const baseUrl = process.env.SITE_URL || 'https://fitnessbymaddy.com';
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${details.slug}`;
  const intakeUrl = `${baseUrl}/intake?lead=${lead.id}`;

  const params = market === 'IN'
    ? [details.name, `₹${details.price * 83}`, checkoutUrl, intakeUrl]
    : [details.name, `$${details.price}`, checkoutUrl, intakeUrl];

  await sendWhatsApp(lead.phone, 'program_offer', params);

  return res.status(200).json({ action: 'program_offered', program, lead_id: lead.id });
}
