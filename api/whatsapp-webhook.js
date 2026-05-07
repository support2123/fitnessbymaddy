const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { logMessage, canSendMessage, isOptedOut } = require('../lib/messages');
const {
  detectMarket,
  detectProgram,
  needsEscalation,
  isOptOut,
  programLabel,
  getCheckoutUrl,
} = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.sender;
    const message = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const db = getSupabase();

    await logMessage(phone, 'in', message);

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out received from ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (await isOptedOut(phone)) {
      return res.status(200).json({ action: 'skipped_opted_out' });
    }

    if (needsEscalation(message)) {
      await createEscalation(db, phone, message);
      await notifyMaddy(phone, message);
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, name, message, res);
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      return await handleLeadQualification(db, existingLead, message, res);
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);

  const { data: lead, error } = await db
    .from('leads')
    .insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message ? message.substring(0, 500) : null,
      last_msg_at: new Date().toISOString(),
      market,
    })
    .select()
    .single();

  if (error) {
    console.error('Insert lead error:', error.message);
    return res.status(500).json({ error: 'Failed to create lead' });
  }

  const detectedProgram = detectProgram(message);
  if (detectedProgram) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: detectedProgram,
    }).eq('id', lead.id);

    await sendProgramReply(phone, detectedProgram, lead.id, market);
    return res.status(200).json({ action: 'new_lead_qualified', program: detectedProgram });
  }

  const welcomeParams = market === 'IN'
    ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
    : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial first?'];

  await sendWhatsApp(phone, 'welcome_v1', welcomeParams);
  await logMessage(phone, 'out', welcomeParams[0], 'welcome_v1');

  scheduleNudge(lead.id, phone, market);

  return res.status(200).json({ action: 'new_lead_welcomed' });
}

async function handleLeadQualification(db, lead, message, res) {
  const program = detectProgram(message);

  if (!program) {
    return res.status(200).json({ action: 'no_program_match' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: program,
  }).eq('id', lead.id);

  await sendProgramReply(lead.phone, program, lead.id, lead.market);

  return res.status(200).json({ action: 'qualified', program });
}

async function sendProgramReply(phone, program, leadId, market) {
  const checkoutUrl = getCheckoutUrl(program);
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${leadId}`;
  const label = programLabel(program);

  let msg;
  if (market === 'IN') {
    msg = `Great choice! ${label} program aapke liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nPehle yeh form bhi fill kardo: ${intakeUrl}`;
  } else {
    msg = `Great choice! The ${label} program is perfect for you.\n\nCheckout here: ${checkoutUrl}\n\nPlease also fill this quick intake form: ${intakeUrl}`;
  }

  await sendWhatsApp(phone, 'program_recommendation', [msg]);
  await logMessage(phone, 'out', msg, 'program_recommendation');
}

async function createEscalation(db, phone, message) {
  const { data: lead } = await db
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .limit(1)
    .single();

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .limit(1)
    .single();

  await db.from('escalations').insert({
    phone,
    lead_id: lead?.id || null,
    client_id: client?.id || null,
    reason: 'keyword_trigger',
    message: message ? message.substring(0, 1000) : null,
    status: 'pending',
  });
}

async function notifyMaddy(phone, message) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  const alert = `ESCALATION: Message from ${maskPhone(phone)} needs your attention:\n"${message?.substring(0, 200)}"`;
  await sendWhatsApp(maddyPhone, 'escalation_alert', [alert]);
}

function scheduleNudge(leadId, phone, market) {
  // Nudges are handled by the cron/nudge-dropped endpoint
  // which runs daily and checks for leads that haven't replied
  console.log(`Nudge scheduled for lead ${leadId} (${maskPhone(phone)})`);
}
