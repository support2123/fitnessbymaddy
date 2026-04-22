const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy, classifyProgram, PROGRAM_NAMES } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload);
    const text = extractText(payload);

    if (!phone) return res.status(400).json({ error: 'No phone number found' });

    const db = getSupabase();

    await logMessage({
      phone,
      direction: 'in',
      body: text,
      template_name: null,
      status: 'received',
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy({
        reason: 'Sensitive keyword detected in message',
        phone,
        context: text.slice(0, 200),
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, text, res);
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, text, res);
    }

    return res.json({ action: 'logged', lead_status: existingLead.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, text, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  const { data: lead } = await db
    .from('leads')
    .insert({
      phone,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      market,
    })
    .select()
    .single();

  const welcomeValues = hinglish
    ? ['Hi! Maddy ki team se baat ho rahi hai 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
    : ['Hi! You\'re speaking with Maddy\'s team 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?'];

  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    bodyValues: welcomeValues,
  });

  return res.json({ action: 'new_lead', lead_id: lead.id });
}

async function handleQualification(db, lead, text, res) {
  const program = classifyProgram(text);

  if (!program) {
    const hinglish = isHinglish(lead.market);
    const body = hinglish
      ? 'Koi baat nahi! Zara batao — gym jaate ho ya ghar pe workout karna hai? Aur main goal kya hai?'
      : 'No worries! Just tell me — do you go to a gym or prefer home workouts? And what\'s your main goal?';

    await sendWhatsApp({
      phone: lead.phone,
      templateName: 'clarify_goal',
      bodyValues: [body],
    });

    return res.json({ action: 'clarification_sent' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: program,
  }).eq('id', lead.id);

  const hinglish = isHinglish(lead.market);
  const programName = PROGRAM_NAMES[program];
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const body = hinglish
    ? `Perfect choice! 🔥 Tumhare liye ${programName} best rahega.\n\n` +
      `👉 Checkout: ${checkoutUrl}\n` +
      `📝 Intake form bhi fill karo: ${intakeUrl}\n\n` +
      `Koi sawaal ho toh poochho!`
    : `Perfect choice! 🔥 ${programName} is the best fit for you.\n\n` +
      `👉 Checkout: ${checkoutUrl}\n` +
      `📝 Please fill the intake form too: ${intakeUrl}\n\n` +
      `Any questions? Just ask!`;

  await sendWhatsApp({
    phone: lead.phone,
    templateName: 'program_recommendation',
    bodyValues: [body],
  });

  return res.json({ action: 'qualified', program });
}

function normalizePhone(payload) {
  if (payload.phone) return payload.phone;
  if (payload.from) return payload.from;
  if (payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from) {
    return '+' + payload.entry[0].changes[0].value.messages[0].from;
  }
  if (payload.waId) return '+' + payload.waId;
  if (payload.senderPhone) return payload.senderPhone;
  return null;
}

function extractText(payload) {
  if (payload.text) return payload.text;
  if (payload.message) return payload.message;
  if (payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return payload.entry[0].changes[0].value.messages[0].text.body;
  }
  if (payload.body) return payload.body;
  return '';
}
