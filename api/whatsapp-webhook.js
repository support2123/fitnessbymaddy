const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText, detectMarket, needsEscalation, escalateToMaddy } = require('./lib/whatsapp');
const { matchProgram } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'];
    if (challenge) return res.status(200).send(challenge);
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = extractPhone(payload);
    const text = extractText(payload);
    const name = extractName(payload);

    if (!phone || !text) {
      return res.status(200).json({ status: 'no_action' });
    }

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      template_name: null,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    const lower = text.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy(phone, 'Keyword match in message', text);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, name, text, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'lead_dropped_no_action' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, text, res);
    }

    return res.status(200).json({ status: 'processed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, text, res) {
  const market = detectMarket(phone);

  await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    program_interest: null,
    market,
  });

  const greeting = market === 'IN'
    ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
    : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS, strength, or 40+ fitness? Or want to try a trial session first?'];

  await sendTemplate(phone, 'welcome_v1', greeting);

  return res.status(200).json({ status: 'new_lead_greeted' });
}

async function handleQualification(db, lead, text, res) {
  const program = matchProgram(text);

  if (!program) {
    const market = lead.market || 'GLOBAL';
    const msg = market === 'IN'
      ? 'Koi tension nahi! Ye options hain:\n• Fat loss / Shred — $97\n• PCOS Warrior — $45\n• 40+ Strong — $50\n• 12-Week Custom — $200\n• Zoom Trial — $20\n\nKaunsa try karna hai?'
      : 'No worries! Here are the options:\n• Fat loss / Shred — $97\n• PCOS Warrior — $45\n• 40+ Strong — $50\n• 12-Week Custom — $200\n• Zoom Trial — $20\n\nWhich one interests you?';
    await sendText(lead.phone, msg);
    return res.status(200).json({ status: 'options_sent' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: program.key,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program.checkout}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const market = lead.market || 'GLOBAL';
  const msg = market === 'IN'
    ? `Great choice! ${program.name} ($${program.price}) ke liye ye links use karo:\n\nCheckout: ${checkoutUrl}\nIntake Form: ${intakeUrl}\n\nPayment ke baad turant access milega!`
    : `Great choice! Here are your links for ${program.name} ($${program.price}):\n\nCheckout: ${checkoutUrl}\nIntake Form: ${intakeUrl}\n\nYou'll get instant access after payment!`;

  await sendText(lead.phone, msg);

  return res.status(200).json({ status: 'qualified', program: program.key });
}

function extractPhone(payload) {
  try {
    if (payload.entry) {
      const changes = payload.entry[0]?.changes?.[0]?.value;
      return '+' + (changes?.messages?.[0]?.from || '');
    }
    if (payload.mobile) return '+' + payload.mobile;
    if (payload.phone) return payload.phone.startsWith('+') ? payload.phone : '+' + payload.phone;
  } catch { /* ignore */ }
  return null;
}

function extractText(payload) {
  try {
    if (payload.entry) {
      return payload.entry[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body || '';
    }
    return payload.text || payload.message || '';
  } catch { /* ignore */ }
  return '';
}

function extractName(payload) {
  try {
    if (payload.entry) {
      return payload.entry[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name || null;
    }
    return payload.name || null;
  } catch { /* ignore */ }
  return null;
}
