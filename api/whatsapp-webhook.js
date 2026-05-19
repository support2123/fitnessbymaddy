const { getClient } = require('./lib/supabase');
const { sendTemplate, sendText, notifyMaddy, logMessage } = require('./lib/whatsapp');
const {
  normalizePhone, detectMarket, isHinglish, parseBody,
  cors, checkEscalation, detectProgram, maskPhone,
  PROGRAM_NAMES, PROGRAM_PRICES
} = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const phone = normalizePhone(body.mobile || body.phone || body.from || '');
    const text = (body.message || body.text || body.body || '').trim();
    const name = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    console.log(`[Webhook] Incoming from ${maskPhone(phone)}: ${text.substring(0, 50)}`);

    await logMessage(phone, 'in', text, null);

    if (/\b(stop|unsubscribe)\b/i.test(text)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalation = checkEscalation(text);
    if (escalation.shouldEscalate) {
      await notifyMaddy(
        'Lead/Client Message Flagged',
        `Phone: ${maskPhone(phone)}\nMessage: ${text}\nTriggers: ${escalation.triggers.join(', ')}`
      );
    }

    const db = getClient();
    const { data: existing } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existing) {
      await handleNewLead(db, phone, name, text);
    } else {
      await handleExistingLead(db, existing, text);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, text) {
  const market = detectMarket(phone);
  const program = detectProgram(text);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text || null,
    last_msg_at: new Date().toISOString(),
    program_interest: program,
    market
  }).select().single();

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', [name || 'there']);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
  }

  if (program) {
    await routeToProgram(db, lead, program, market);
  }
}

async function handleExistingLead(db, lead, text) {
  if (lead.status === 'dropped') return;

  await db.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  if (lead.status === 'new' || lead.status === 'qualified') {
    const program = detectProgram(text);
    if (program) {
      await db.from('leads')
        .update({ program_interest: program, status: 'qualified' })
        .eq('id', lead.id);
      await routeToProgram(db, lead, program, lead.market);
    }
  }
}

async function routeToProgram(db, lead, program, market) {
  const programName = PROGRAM_NAMES[program] || program;
  const price = PROGRAM_PRICES[program] || 0;
  const hinglish = isHinglish(market);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  let msg;
  if (hinglish) {
    msg = `Great choice! 🔥 ${programName} — $${price}\n\n` +
      `Payment link: ${checkoutUrl}\n\n` +
      `Payment ke baad ye form bhar dena:\n${intakeUrl}\n\n` +
      `Koi bhi question ho toh pooch lo!`;
  } else {
    msg = `Great choice! 🔥 ${programName} — $${price}\n\n` +
      `Payment link: ${checkoutUrl}\n\n` +
      `After payment, please fill this intake form:\n${intakeUrl}\n\n` +
      `Any questions? Just ask!`;
  }

  await sendText(lead.phone, msg);
  await db.from('leads')
    .update({ status: 'qualified', program_interest: program })
    .eq('id', lead.id);
}

async function handleOptOut(phone) {
  const db = getClient();
  await db.from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);
}
