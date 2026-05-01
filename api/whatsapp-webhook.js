const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { normalizePhone, detectMarket, maskPhone, isHinglish } = require('../lib/phone');
const { needsEscalation, escalate } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keys: ['fat loss', 'weight', 'shred', 'lose fat', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keys: ['pcos', 'hormonal', 'hormone'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keys: ['40', 'menopause', 'joints', 'joint', 'mature'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keys: ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keys: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' }
];

const OPT_OUT = ['stop', 'unsubscribe', 'opt out', 'cancel messages'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { phone: rawPhone, message, name: senderName } = parseWebhookBody(req.body);
    if (!rawPhone || !message) return res.status(400).json({ error: 'Missing phone or message' });

    const phone = normalizePhone(rawPhone);
    const market = detectMarket(phone);
    const body = message.trim();
    const lower = body.toLowerCase();

    await db.from('messages').insert({
      phone, direction: 'in', body, sent_at: new Date().toISOString(), status: 'received'
    });

    if (OPT_OUT.some(kw => lower.includes(kw))) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(body)) {
      await escalate(phone, 'keyword_trigger', body);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!existingLead || existingLead.length === 0) {
      await handleNewLead(db, phone, body, senderName, market);
      return res.json({ action: 'new_lead_greeted' });
    }

    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.json({ action: 'dropped_ignored' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

    if (lead.status === 'new') {
      const matched = matchProgram(lower);
      if (matched) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: matched.program
        }).eq('id', lead.id);

        const hinglish = isHinglish(market);
        const msg = hinglish
          ? `${matched.name} — perfect choice! 🔥\n\nYahan se checkout karo:\nhttps://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}\n\nAur intake form bhi fill karo:\nhttps://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`
          : `${matched.name} — great choice! 🔥\n\nCheckout here:\nhttps://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}\n\nAlso fill out the intake form:\nhttps://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

        await sendWhatsApp({ phone, body: msg, templateName: 'program_route' });
        return res.json({ action: 'qualified', program: matched.program });
      }
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, firstMsg, name, market) {
  const { data: lead } = await db.from('leads').insert({
    phone, name: name || null, source: 'whatsapp', status: 'new',
    first_msg: firstMsg, last_msg_at: new Date().toISOString(), market
  }).select().single();

  const hinglish = isHinglish(market);
  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    params: hinglish
      ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
      : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?']
  });

  scheduleNudge(db, lead.id, phone, market);
}

async function scheduleNudge(db, leadId, phone, market) {
  // Nudge logic handled by cron/nudge-dropped — stores timing in lead.created_at
}

function matchProgram(lower) {
  for (const route of PROGRAM_ROUTES) {
    if (route.keys.some(k => lower.includes(k))) return route;
  }
  return null;
}

function parseWebhookBody(body) {
  if (!body) return {};

  // AiSensy webhook format
  if (body.phone_number || body.mobile) {
    return {
      phone: body.phone_number || body.mobile,
      message: body.message || body.text || body.body || '',
      name: body.name || body.customer_name || ''
    };
  }

  // Meta Cloud API format
  if (body.entry) {
    try {
      const change = body.entry[0].changes[0].value;
      const msg = change.messages && change.messages[0];
      if (!msg) return {};
      const contact = change.contacts && change.contacts[0];
      return {
        phone: msg.from,
        message: msg.text ? msg.text.body : '',
        name: contact ? contact.profile.name : ''
      };
    } catch { return {}; }
  }

  return {
    phone: body.phone || body.from || '',
    message: body.message || body.text || body.body || '',
    name: body.name || ''
  };
}
