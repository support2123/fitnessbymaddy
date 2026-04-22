const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendText, canSendMessage, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, escalateToMaddy, classifyIntent } = require('./_lib/escalation');

const PROGRAM_LABELS = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: '$97' },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: '$97' },
  '12wk': { name: '12-Week Custom Program', price: '$200' },
  pcos: { name: 'PCOS Warrior Program', price: '$45' },
  '40plus': { name: '40+ Strong Program', price: '$50' },
  zoom_trial: { name: 'Zoom Trial Session', price: '$20' },
  zoom_pack: { name: 'Zoom Pack (4 sessions)', price: '$70' },
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { phone, message, name } = parsePayload(req.body);
    if (!phone || !message) return res.status(400).json({ error: 'Missing phone or message' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    if (/\b(stop|unsubscribe|opt.?out)\b/i.test(message)) {
      await db
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', { phone, text: message });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, message, name, res);
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    return await handleExistingLead(db, existingLead, message, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parsePayload(body) {
  if (body.mobile) {
    return {
      phone: body.mobile,
      message: body.text || body.message || '',
      name: body.name || null,
    };
  }
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (msg) {
      return {
        phone: msg.from,
        message: msg.text?.body || '',
        name: change?.contacts?.[0]?.profile?.name || null,
      };
    }
  }
  return {
    phone: body.phone,
    message: body.message || body.text || '',
    name: body.name || null,
  };
}

async function handleNewLead(db, phone, message, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
    })
    .select()
    .single();

  const intent = classifyIntent(message);

  if (intent && PROGRAM_LABELS[intent]) {
    await db
      .from('leads')
      .update({ status: 'qualified', program_interest: intent })
      .eq('id', lead.id);

    const label = PROGRAM_LABELS[intent];
    if (isHinglish(market)) {
      await sendTemplate(phone, 'program_intro_hi', [label.name, label.price]);
    } else {
      await sendTemplate(phone, 'program_intro_en', [label.name, label.price]);
    }
    return res.json({ action: 'qualified', program: intent });
  }

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1_hi', [name || 'there']);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
  }

  return res.json({ action: 'new_lead', id: lead.id });
}

async function handleExistingLead(db, lead, message, res) {
  await db
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const intent = classifyIntent(message);

  if (intent && lead.status === 'new') {
    await db
      .from('leads')
      .update({ status: 'qualified', program_interest: intent })
      .eq('id', lead.id);

    const label = PROGRAM_LABELS[intent];
    const market = lead.market || 'GLOBAL';

    if (isHinglish(market)) {
      await sendTemplate(lead.phone, 'program_intro_hi', [label.name, label.price]);
    } else {
      await sendTemplate(lead.phone, 'program_intro_en', [label.name, label.price]);
    }
    return res.json({ action: 'qualified', program: intent });
  }

  return res.json({ action: 'noted' });
}
