const supabase = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const {
  detectMarket, isOptOut, needsEscalation,
  detectProgram, handleCors, PROGRAM_NAMES
} = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone || !message) return res.status(400).json({ error: 'Missing phone or message' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message, status: 'received'
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', {
        phone, name, details: message.slice(0, 200)
      });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!existingLead || existingLead.length === 0) {
      await handleNewLead(phone, message, name);
      return res.status(200).json({ action: 'new_lead_greeted' });
    }

    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    if (lead.status === 'new') {
      await handleQualification(lead, message, phone);
      return res.status(200).json({ action: 'lead_qualified' });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (body.messageContent) {
    return {
      phone: body.senderPhoneNumber || body.phone,
      message: body.messageContent || body.message,
      name: body.senderName || body.name || null
    };
  }
  return {
    phone: body.phone || body.from,
    message: body.message || body.text || body.body,
    name: body.name || body.profile_name || null
  };
}

async function handleNewLead(phone, message, name) {
  const market = detectMarket(phone);
  const program = detectProgram(message);

  await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: program ? 'qualified' : 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    program_interest: program,
    market
  });

  if (market === 'IN') {
    await sendTemplate(phone, 'welcome_v1_hindi', [name || 'there'], true);
  } else {
    await sendTemplate(phone, 'welcome_v1', [name || 'there'], true);
  }

  if (program) {
    await sendProgramCheckoutLink(phone, program, market);
  }
}

async function handleQualification(lead, message, phone) {
  const program = detectProgram(message);
  if (!program) return;

  await supabase.from('leads')
    .update({ status: 'qualified', program_interest: program })
    .eq('id', lead.id);

  await sendProgramCheckoutLink(phone, program, lead.market);
}

async function sendProgramCheckoutLink(phone, program, market) {
  const programName = PROGRAM_NAMES[program] || program;
  const checkoutBase = 'https://fitnessbymaddyy.exlyapp.com/checkout';
  const intakeBase = 'https://www.fitnessbymaddy.com/intake.html';

  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1);

  const leadId = lead && lead[0] ? lead[0].id : '';

  const params = [
    programName,
    `${checkoutBase}/${program}`,
    `${intakeBase}?lead=${leadId}`
  ];

  if (market === 'IN') {
    await sendTemplate(phone, 'program_offer_hindi', params);
  } else {
    await sendTemplate(phone, 'program_offer', params);
  }
}
