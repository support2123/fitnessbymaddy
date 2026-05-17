const { supabase } = require('./_lib/supabase');
const { sendTemplate, logMessage, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, isOptOut, detectProgram } = require('./_lib/escalation');

const SITE = process.env.SITE_URL || 'https://fitnessbymaddy.com';
const EXLY_BASE = 'https://fitnessbymaddyy.exlyapp.com/checkout';

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Shred',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Flagship',
  'zoom_trial': '$20 Zoom Trial',
  'zoom_pack': 'Zoom Session Pack'
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.phone || payload.from || '');
    const text = (payload.message || payload.text || payload.body || '').trim();
    const senderName = payload.name || payload.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalation = needsEscalation(text);
    if (escalation.escalate) {
      await notifyMaddy('Escalation Required', `${maskPhone(phone)} mentioned "${escalation.trigger}": ${text.slice(0, 200)}`);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, text, senderName, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'new') {
      return await handleQualification(phone, text, existingLead, res);
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, text, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1_hi', [name || 'there'], name);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there'], name);
  }

  if (text) {
    const program = detectProgram(text);
    if (program) {
      await supabase.from('leads').update({ program_interest: program, status: 'qualified' }).eq('id', lead.id);
      await sendProgramLink(phone, program, lead.id, market, name);
      return res.status(200).json({ action: 'new_lead_qualified', program });
    }
  }

  return res.status(200).json({ action: 'new_lead_welcomed', lead_id: lead.id });
}

async function handleQualification(phone, text, lead, res) {
  const program = detectProgram(text);
  if (!program) {
    return res.status(200).json({ action: 'awaiting_qualification' });
  }

  await supabase.from('leads').update({
    program_interest: program,
    status: 'qualified'
  }).eq('id', lead.id);

  await sendProgramLink(phone, program, lead.id, lead.market, lead.name);

  return res.status(200).json({ action: 'qualified', program });
}

async function sendProgramLink(phone, program, leadId, market, name) {
  const programName = PROGRAM_NAMES[program] || program;
  const checkoutUrl = `${EXLY_BASE}/${program}`;
  const intakeUrl = `${SITE}/intake?lead=${leadId}`;

  if (isHinglish(market)) {
    await sendTemplate(phone, 'program_link_hi', [name || 'there', programName, checkoutUrl, intakeUrl], name);
  } else {
    await sendTemplate(phone, 'program_link_en', [name || 'there', programName, checkoutUrl, intakeUrl], name);
  }
}

function normalizePhone(phone) {
  let p = phone.replace(/[^0-9+]/g, '');
  if (!p.startsWith('+') && p.length >= 10) {
    if (p.startsWith('91') && p.length >= 12) p = '+' + p;
    else if (p.startsWith('971') || p.startsWith('44')) p = '+' + p;
    else p = '+91' + p;
  }
  return p;
}
