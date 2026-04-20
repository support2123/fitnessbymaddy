const supabase = require('../lib/supabase');
const { sendTemplate, sendText, logMessage, notifyMaddy } = require('../lib/whatsapp');
const {
  detectMarket, isHinglish, needsEscalation, isOptOut,
  detectProgram, maskPhone, PROGRAM_NAMES, corsHeaders
} = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const message = extractMessage(req.body);
    if (!message) return res.status(200).json({ ok: true, note: 'no message' });

    const { phone, text, name } = message;
    const market = detectMarket(phone);

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(
        'Lead needs attention',
        `Phone: ${maskPhone(phone)}\nMessage: ${text}`
      );
      return res.status(200).json({ ok: true, action: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await handleNewLead(phone, name, text, market);
    } else if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'dropped_lead_ignored' });
    } else if (existingLead.status === 'new') {
      await handleQualification(existingLead, text, market);
    } else {
      await supabase.from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true, error: 'handled' });
  }
};

function extractMessage(body) {
  // Meta Cloud API format
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: msg.from,
      text: msg.text?.body || '',
      name: contact?.profile?.name || null
    };
  }
  // AiSensy simplified format
  if (body?.mobile && body?.message) {
    return {
      phone: body.mobile,
      text: body.message,
      name: body.name || null
    };
  }
  return null;
}

async function handleNewLead(phone, name, text, market) {
  await supabase.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  });

  await sendTemplate(phone, 'welcome_v1', [name || 'there']);

  const program = detectProgram(text);
  if (program) {
    await supabase.from('leads')
      .update({ program_interest: program, status: 'qualified' })
      .eq('phone', phone);
    await sendProgramInfo(phone, program, market);
  }
}

async function handleQualification(lead, text, market) {
  const program = detectProgram(text);
  if (!program) {
    const reply = isHinglish(market)
      ? 'Koi baat nahi! Apna goal batao — fat loss, PCOS, strength, ya 40+ fitness? Ya pehle ek trial class try karo?'
      : 'No worries! Tell me your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a trial class first?';
    await sendText(lead.phone, reply);
    return;
  }

  await supabase.from('leads').update({
    program_interest: program,
    status: 'qualified',
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  await sendProgramInfo(lead.phone, program, market);
}

async function sendProgramInfo(phone, program, market) {
  const name = PROGRAM_NAMES[program];
  const hinglish = isHinglish(market);

  const msg = hinglish
    ? `Great choice! 🔥 ${name} program perfect hai tumhare liye.\n\nCheckout karo: https://fitnessbymaddyy.exlyapp.com/checkout/${program}\n\nPehle apni details bhi fill karo: https://fitnessbymaddy.com/intake?program=${program}`
    : `Great choice! 🔥 The ${name} program is perfect for you.\n\nCheckout here: https://fitnessbymaddyy.exlyapp.com/checkout/${program}\n\nAlso fill in your details: https://fitnessbymaddy.com/intake?program=${program}`;

  await sendText(phone, msg);
}
