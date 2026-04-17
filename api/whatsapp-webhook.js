const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, escalateToMaddy, maskPhone, MADDY_PHONE } = require('./_lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'slim', 'lean'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'transform'], program: '12wk', label: '12-Week Custom' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'ghar'], program: '6wk_home', label: '6-Week Home' },
  { keywords: ['strength', 'muscle', 'gym', 'build'], program: '6wk_gym', label: '6-Week Burn & Build' },
];

const CHECKOUT_MAP = {
  '6wk_gym': 'checkout/6wk-burn-build',
  '6wk_home': 'checkout/6wk-home',
  '12wk': 'checkout/12wk-custom',
  'pcos': 'checkout/pcos-warrior',
  '40plus': 'checkout/40plus-strong',
  'zoom_trial': 'checkout/zoom-trial',
  'zoom_pack': 'checkout/zoom-pack',
};

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const message = extractMessage(payload);
    if (!message) return res.status(200).json({ ok: true });

    const { phone, name, text } = message;

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text, status: 'received'
    });

    if (/\b(stop|unsubscribe|opt.?out)\b/i.test(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(phone, 'Escalation keyword detected', text);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, name, text, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'dropped_lead_ignored' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, text, res);
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.status(200).json({ ok: true, action: 'updated' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
};

function extractMessage(payload) {
  try {
    if (payload.entry) {
      const change = payload.entry[0]?.changes?.[0]?.value;
      const msg = change?.messages?.[0];
      if (!msg || msg.type !== 'text') return null;
      const contact = change?.contacts?.[0];
      return {
        phone: '+' + msg.from,
        name: contact?.profile?.name || '',
        text: msg.text?.body || ''
      };
    }
    if (payload.phone && payload.message) {
      return {
        phone: payload.phone.startsWith('+') ? payload.phone : '+' + payload.phone,
        name: payload.name || '',
        text: payload.message
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function handleNewLead(phone, name, text, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  await supabase.from('leads').insert({
    phone, name, source: 'whatsapp', status: 'new',
    first_msg: text, last_msg_at: new Date().toISOString(), market
  });

  const matched = matchProgram(text);
  if (matched) {
    await supabase.from('leads').update({
      status: 'qualified', program_interest: matched.program
    }).eq('phone', phone);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/${CHECKOUT_MAP[matched.program] || 'checkout'}`;

    const msg = hinglish
      ? `Great choice! ${matched.label} program tere goal ke liye perfect hai. Yeh raha checkout link: ${checkoutUrl}\n\nSaath mein yeh intake form bhi fill kar do: https://fitnessbymaddy.com/intake?phone=${encodeURIComponent(phone)}`
      : `Great choice! The ${matched.label} program is perfect for your goal. Here's your checkout link: ${checkoutUrl}\n\nAlso fill out this intake form: https://fitnessbymaddy.com/intake?phone=${encodeURIComponent(phone)}`;

    await sendWhatsApp({ phone, templateName: 'program_recommendation', params: [name || 'there', matched.label, checkoutUrl], body: msg });
    return res.status(200).json({ ok: true, action: 'qualified', program: matched.program });
  }

  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    params: [name || 'there'],
    body: hinglish
      ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?"
  });

  return res.status(200).json({ ok: true, action: 'new_lead_welcomed' });
}

async function handleQualification(lead, text, res) {
  const matched = matchProgram(text);
  const market = lead.market || detectMarket(lead.phone);
  const hinglish = isHinglish(market);

  if (!matched) {
    const msg = hinglish
      ? "Samajh nahi aaya — kya fat loss chahiye, PCOS help, 40+ fitness, ya ek trial class? Batao main sahi program suggest karun!"
      : "I didn't quite catch that — are you looking for fat loss, PCOS help, 40+ fitness, or a trial class? Let me suggest the right program!";

    await sendWhatsApp({ phone: lead.phone, templateName: 'clarify_goal', params: [lead.name || 'there'], body: msg });
    return res.status(200).json({ ok: true, action: 'asked_clarification' });
  }

  await supabase.from('leads').update({
    status: 'qualified', program_interest: matched.program, last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/${CHECKOUT_MAP[matched.program] || 'checkout'}`;

  const msg = hinglish
    ? `Perfect! ${matched.label} tere liye best rahega. Checkout yahan se karo: ${checkoutUrl}\n\nYeh intake form bhi fill karo: https://fitnessbymaddy.com/intake?phone=${encodeURIComponent(lead.phone)}`
    : `Perfect! The ${matched.label} program would be best for you. Checkout here: ${checkoutUrl}\n\nAlso fill out this intake form: https://fitnessbymaddy.com/intake?phone=${encodeURIComponent(lead.phone)}`;

  await sendWhatsApp({ phone: lead.phone, templateName: 'program_recommendation', params: [lead.name || 'there', matched.label, checkoutUrl], body: msg });

  return res.status(200).json({ ok: true, action: 'qualified', program: matched.program });
}

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

async function notifyMaddy(phone, reason, message) {
  const masked = maskPhone(phone);
  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    params: [masked, reason, (message || '').substring(0, 200)],
    body: `ESCALATION\nLead: ${masked}\nReason: ${reason}\nMsg: "${(message || '').substring(0, 200)}"`
  });
}
