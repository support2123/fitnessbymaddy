import supabase from '../lib/supabase.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { escalateToMaddy } from '../lib/escalation.js';
import {
  detectMarket, detectProgram, isOptOut, shouldEscalate,
  isHinglish, programLabel, maskPhone, cors, parseBody
} from '../lib/helpers.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const phone = body.senderPhone || body.waId || body.from;
    const message = body.message || body.text || body.body || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (shouldEscalate(message)) {
      await escalateToMaddy('Sensitive keyword detected', {
        phone, details: message.slice(0, 200)
      });
    }

    const { data: existing } = await supabase
      .from('leads').select('id, status, market').eq('phone', phone).single();

    if (!existing) {
      return await handleNewLead(phone, message, res);
    }

    if (existing.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    return await handleReply(existing, phone, message, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

async function handleNewLead(phone, message, res) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase.from('leads').insert({
    phone,
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market,
    status: 'new'
  }).select().single();

  const welcomeParams = isHinglish(market)
    ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
    : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

  await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

  const programCode = detectProgram(message);
  if (programCode) {
    await supabase.from('leads').update({
      status: 'qualified',
      program_interest: programCode
    }).eq('id', lead.id);

    await sendProgramLink(phone, programCode, lead.id, market);
  }

  return res.json({ action: 'new_lead', id: lead.id, program: programCode });
}

async function handleReply(lead, phone, message, res) {
  await supabase.from('leads').update({
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const programCode = detectProgram(message);
  if (programCode) {
    await supabase.from('leads').update({
      status: 'qualified',
      program_interest: programCode
    }).eq('id', lead.id);

    await sendProgramLink(phone, programCode, lead.id, lead.market);
    return res.json({ action: 'qualified', program: programCode });
  }

  return res.json({ action: 'received', id: lead.id });
}

async function sendProgramLink(phone, programCode, leadId, market) {
  const label = programLabel(programCode);
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${programCode}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${leadId}`;

  const msg = isHinglish(market)
    ? [`${label} — yeh raha aapka link! 🔗\n\nCheckout: ${checkoutUrl}\n\nIntake form bhi fill kar dijiye: ${intakeUrl}`]
    : [`${label} — here's your link! 🔗\n\nCheckout: ${checkoutUrl}\n\nPlease also fill the intake form: ${intakeUrl}`];

  await sendWhatsApp(phone, 'program_link', msg);
}
