const { supabase } = require('../lib/supabase');
const { sendWhatsApp, logMessage, notifyMaddy } = require('../lib/whatsapp');
const {
  detectMarket, matchProgram, needsEscalation, isOptOut,
  isHinglish, maskPhone, PROGRAM_NAMES, cors
} = require('../lib/helpers');
const { checkAndEscalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.phone || payload.from);
    const text = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logMessage({ phone, direction: 'in', body: text, template_name: null, status: 'received' });

    if (isOptOut(text)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await checkAndEscalate({ phone, name, message: text, reason: 'Medical/safety keyword detected' });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      const action = await handleNewLead(phone, text, name);
      return res.status(200).json({ action });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    const action = await handleLeadReply(existingLead, text);
    return res.status(200).json({ action });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, text, name) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  });

  const hinglish = isHinglish(market);

  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    bodyValues: hinglish
      ? [name || 'there']
      : [name || 'there']
  });

  scheduleNudge(phone, market);

  return 'new_lead_greeted';
}

async function handleLeadReply(lead, text) {
  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const program = matchProgram(text);
  if (!program) return 'reply_no_match';

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: program
    })
    .eq('id', lead.id);

  const hinglish = isHinglish(lead.market);
  const programName = PROGRAM_NAMES[program];

  await sendWhatsApp({
    phone: lead.phone,
    templateName: 'program_link',
    bodyValues: [
      lead.name || 'there',
      programName,
      `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`,
      `https://fitnessbymaddy.com/intake?lead=${lead.id}`
    ]
  });

  return 'lead_qualified';
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

function scheduleNudge(phone, market) {
  // Nudges handled by the cron/nudge-dropped endpoint
  // which checks leads with status='new' and no reply after 2hrs/24hrs
}

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[\s\-()]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}
