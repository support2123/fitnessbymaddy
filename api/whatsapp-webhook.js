const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalate');
const {
  detectMarket, detectProgram, needsEscalation, isOptOut,
  isHinglish, getCheckoutUrl, getIntakeUrl, PROGRAM_NAMES,
  parseBody, maskPhone
} = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await parseBody(req);

    const phone = body.mobile || body.phone || body.from || '';
    const message = body.message || body.text || body.body || '';
    const senderName = body.name || body.senderName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number provided' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (isOptOut(message)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .limit(1)
        .single();

      await escalateToMaddy(
        phone,
        'Keyword trigger in message',
        message,
        client?.id
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, message, senderName, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'converted') {
      return res.status(200).json({ action: 'already_converted' });
    }

    return await handleExistingLead(existingLead, message, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, message, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market
    })
    .select()
    .single();

  const hinglish = isHinglish(market);

  if (hinglish) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there'
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there'
    ]);
  }

  scheduleNudge(phone, lead.id, market);

  return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
}

async function handleExistingLead(lead, message, res) {
  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const program = detectProgram(message);

  if (program) {
    await supabase
      .from('leads')
      .update({
        status: 'qualified',
        program_interest: program
      })
      .eq('id', lead.id);

    const checkoutUrl = getCheckoutUrl(program);
    const intakeUrl = getIntakeUrl(lead.id);
    const programName = PROGRAM_NAMES[program] || program;
    const hinglish = isHinglish(lead.market);

    if (hinglish) {
      await sendTemplate(lead.phone, 'program_match', [
        lead.name || 'there',
        programName,
        checkoutUrl,
        intakeUrl
      ]);
    } else {
      await sendTemplate(lead.phone, 'program_match_en', [
        lead.name || 'there',
        programName,
        checkoutUrl,
        intakeUrl
      ]);
    }

    return res.status(200).json({ action: 'qualified', program });
  }

  return res.status(200).json({ action: 'reply_received' });
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

  console.log(`Opt-out: ${maskPhone(phone)}`);
}

function scheduleNudge(phone, leadId, market) {
  const twoHours = 2 * 60 * 60 * 1000;
  const twentyFourHours = 24 * 60 * 60 * 1000;

  setTimeout(async () => {
    const { data: lead } = await supabase
      .from('leads')
      .select('status')
      .eq('id', leadId)
      .single();

    if (lead && lead.status === 'new') {
      const hinglish = isHinglish(market);
      await sendTemplate(phone,
        hinglish ? 'nudge_trial' : 'nudge_trial_en',
        []
      );
    }
  }, twoHours);

  setTimeout(async () => {
    const { data: lead } = await supabase
      .from('leads')
      .select('status')
      .eq('id', leadId)
      .single();

    if (lead && lead.status === 'new') {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('id', leadId);
      console.log(`Auto-dropped lead ${maskPhone(phone)} after 24hrs`);
    }
  }, twentyFourHours);
}
