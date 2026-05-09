const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText, logMessage, notifyMaddy, maskPhone, detectMarket, isHinglish, checkEscalation, detectProgram } = require('./lib/whatsapp');
const { canSendToLead, isOptedOut } = require('./lib/rate-limit');

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Flagship',
  'zoom_trial': '$20 Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack'
};

const PROGRAM_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'fitnessbymaddy-whatsapp' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = extractPhone(payload);
    const message = extractMessage(payload);
    const senderName = extractName(payload);

    if (!phone || !message) {
      return res.status(200).json({ status: 'ignored', reason: 'no phone or message' });
    }

    if (await isOptedOut(phone)) {
      return res.status(200).json({ status: 'ignored', reason: 'opted out' });
    }

    await logMessage(phone, 'in', message, null);

    const lowerMsg = message.toLowerCase().trim();
    if (lowerMsg === 'stop' || lowerMsg === 'unsubscribe') {
      await handleOptOut(phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    const escalationKeyword = checkEscalation(message);
    if (escalationKeyword) {
      await notifyMaddy(`Escalation keyword "${escalationKeyword}" detected`, {
        phone: maskPhone(phone),
        message: message.substring(0, 200)
      });
    }

    const db = getSupabase();
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await handleNewLead(db, phone, message, senderName);
    } else {
      await handleExistingLead(db, existingLead, message);
    }

    return res.status(200).json({ status: 'processed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error', message: err.message });
  }
};

async function handleNewLead(db, phone, message, name) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  const program = detectProgram(message);
  if (program) {
    await qualifyLead(db, lead, program, market);
  } else {
    await sendTemplate(phone, 'welcome_v1', [name || 'there']);
  }
}

async function handleExistingLead(db, lead, message) {
  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

  if (lead.status === 'dropped') {
    return;
  }

  if (lead.status === 'new') {
    const program = detectProgram(message);
    if (program) {
      await qualifyLead(db, lead, program, lead.market);
    }
  }
}

async function qualifyLead(db, lead, program, market) {
  await db.from('leads').update({
    status: 'qualified',
    program_interest: program
  }).eq('id', lead.id);

  const hinglish = isHinglish(market);
  const programName = PROGRAM_NAMES[program] || program;
  const checkoutLink = PROGRAM_LINKS[program] || '';
  const intakeLink = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  let qualifyMsg;
  if (hinglish) {
    qualifyMsg = `Perfect! Tumhare liye best program hai: *${programName}*\n\n` +
      `✅ Checkout karo: ${checkoutLink}\n` +
      `📋 Apni details bharo: ${intakeLink}\n\n` +
      `Koi sawaal ho toh pooch lo! 💪`;
  } else {
    qualifyMsg = `Perfect! The best program for you is: *${programName}*\n\n` +
      `✅ Checkout here: ${checkoutLink}\n` +
      `📋 Fill your details: ${intakeLink}\n\n` +
      `Feel free to ask any questions! 💪`;
  }

  if (await canSendToLead(lead.phone)) {
    await sendText(lead.phone, qualifyMsg);
  }
}

async function handleOptOut(phone) {
  const db = getSupabase();
  await db.from('leads').update({ opted_out: true, status: 'dropped' }).eq('phone', phone);
  await sendText(phone, 'You have been unsubscribed. We will not message you again. Take care! 🙏');
}

function extractPhone(payload) {
  if (payload?.phone) return payload.phone;
  if (payload?.waId) return '+' + payload.waId;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id) {
    return '+' + payload.entry[0].changes[0].value.contacts[0].wa_id;
  }
  if (payload?.sender?.phone) return payload.sender.phone;
  return null;
}

function extractMessage(payload) {
  if (payload?.message) return payload.message;
  if (payload?.text) return payload.text;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return payload.entry[0].changes[0].value.messages[0].text.body;
  }
  if (payload?.body) return payload.body;
  return null;
}

function extractName(payload) {
  if (payload?.name) return payload.name;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name) {
    return payload.entry[0].changes[0].value.contacts[0].profile.name;
  }
  if (payload?.sender?.name) return payload.sender.name;
  return null;
}
