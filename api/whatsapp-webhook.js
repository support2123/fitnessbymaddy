const { getSupabase } = require('./lib/supabase');
const { sendTemplate, logMessage, maskPhone } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const {
  needsEscalation,
  escalateToMaddy,
  classifyProgram,
  PROGRAM_NAMES,
} = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await logMessage(phone, 'in', message, null);

    if (/^(stop|unsubscribe|opt.?out)$/i.test(message.trim())) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy(
        'Flagged message from lead',
        `Phone: ${maskPhone(phone)} | Msg: ${message}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!existingLead || existingLead.length === 0) {
      await handleNewLead(db, phone, name, message, market, hinglish);
      return res.status(200).json({ action: 'new_lead_created' });
    }

    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_opted_out' });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    if (lead.status === 'new') {
      await handleQualification(db, lead, message, hinglish);
      return res.status(200).json({ action: 'qualification_sent' });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (body.mobile) {
    return {
      phone: body.mobile,
      message: body.message || body.text || '',
      name: body.name || null,
    };
  }
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    return {
      phone: msg?.from || '',
      message: msg?.text?.body || '',
      name: contact?.profile?.name || null,
    };
  }
  return {
    phone: body.phone || body.from || '',
    message: body.message || body.text || body.body || '',
    name: body.name || null,
  };
}

async function handleNewLead(db, phone, name, message, market, hinglish) {
  await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market,
  });

  if (hinglish) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there',
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there',
    ]);
  }
}

async function handleQualification(db, lead, message, hinglish) {
  const program = classifyProgram(message);

  if (!program) {
    const reply = hinglish
      ? 'Koi baat nahi! Batao kya goal hai — fat loss, muscle, PCOS fix, ya general fitness? Hum sahi program suggest karenge.'
      : "No worries! Tell us your goal — fat loss, muscle building, PCOS, or general fitness? We'll suggest the right program.";

    await sendTemplate(lead.phone, 'ask_goal', [reply]);
    return;
  }

  await db
    .from('leads')
    .update({ status: 'qualified', program_interest: program })
    .eq('id', lead.id);

  const programName = PROGRAM_NAMES[program];
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  await sendTemplate(lead.phone, 'program_recommendation', [
    lead.name || 'there',
    programName,
    checkoutUrl,
    intakeUrl,
  ]);
}
