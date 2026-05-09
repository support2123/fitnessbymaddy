const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, logInbound } = require('./lib/whatsapp');
const {
  detectMarket, classifyIntent, needsEscalation,
  isOptOut, programLabel, jsonResponse,
} = require('./lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = body.mobile || body.phone || body.from;
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    await logInbound(phone, text);

    const supabase = getSupabase();

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(supabase, phone, text);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(supabase, phone, text, name, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    return await handleReply(supabase, existingLead, text, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(supabase, phone, text, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
    })
    .select()
    .single();

  const isIN = market === 'IN';
  const welcome = isIN
    ? 'Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
    : 'Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

  await sendWhatsApp(phone, welcome, 'welcome_v1');

  scheduleNudge(supabase, phone, lead.id);

  return res.status(200).json({ action: 'new_lead', id: lead.id });
}

async function handleReply(supabase, lead, text, res) {
  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const intent = classifyIntent(text);

  if (!intent) {
    return res.status(200).json({ action: 'no_intent', leadId: lead.id });
  }

  await supabase
    .from('leads')
    .update({ status: 'qualified', program_interest: intent })
    .eq('id', lead.id);

  const isIN = lead.market === 'IN';
  const label = programLabel(intent);

  let replyMsg;
  if (isIN) {
    replyMsg = `Great choice! ${label} aapke liye perfect rahega. Yahan se checkout karein aur apna transformation start karein! Intake form bhi zaroor fill karein taaki hum aapka plan customize kar sakein.`;
  } else {
    replyMsg = `Great choice! The ${label} is perfect for your goal. Complete your checkout and fill out the intake form so we can customize your plan!`;
  }

  await sendWhatsApp(lead.phone, replyMsg);

  return res.status(200).json({
    action: 'qualified',
    leadId: lead.id,
    program: intent,
  });
}

async function notifyMaddy(supabase, phone, text) {
  const maddyPhone = '+917082478374';
  const alert = `ESCALATION: Message from ${phone}: "${text.slice(0, 200)}"`;
  await sendWhatsApp(maddyPhone, alert);
}

function scheduleNudge(supabase, phone, leadId) {
  // Nudge logic handled by /api/cron/nudge-dropped
  // which checks leads with status=new and no reply after 2hrs/24hrs
}
