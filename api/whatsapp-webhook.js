const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText, notifyMaddy, logInbound } = require('./_lib/whatsapp');
const { detectMarket, maskPhone } = require('./_lib/market');
const { needsEscalation, isOptOut } = require('./_lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'burn'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'age'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' },
];

function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;

    let phone, text, senderName;

    if (body.entry) {
      const change = body.entry?.[0]?.changes?.[0]?.value;
      if (!change?.messages?.[0]) return res.status(200).json({ ok: true });
      const msg = change.messages[0];
      phone = '+' + msg.from;
      text = msg.text?.body || '';
      senderName = change.contacts?.[0]?.profile?.name || '';
    } else if (body.phone || body.from) {
      phone = body.phone || body.from;
      if (!phone.startsWith('+')) phone = '+' + phone;
      text = body.message || body.text || body.body || '';
      senderName = body.name || '';
    } else {
      return res.status(200).json({ ok: true, note: 'unrecognized payload' });
    }

    await logInbound(phone, text);

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    const esc = needsEscalation(text);
    if (esc.escalate) {
      await notifyMaddy(
        'Lead message flagged',
        `Phone: ${maskPhone(phone)}\nMessage: ${text}\nTriggers: ${esc.reasons.join(', ')}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: senderName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeParams = market === 'IN'
        ? ["Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"]
        : ["Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or want to try a $20 trial first?"];

      await sendTemplate(phone, 'welcome_v1', welcomeParams, true);

      return res.status(200).json({ ok: true, action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'dropped_lead_ignored' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const matched = matchProgram(text);
      if (matched) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: matched.program
        }).eq('id', existingLead.id);

        const market = existingLead.market || 'IN';
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const msg = market === 'IN'
          ? `Perfect! ${matched.name} (${matched.price}) aapke liye best rahega 💪\n\nCheckout: ${checkoutUrl}\n\nAur ye intake form bhi fill kar do: ${intakeUrl}`
          : `Perfect! ${matched.name} (${matched.price}) is a great fit for you 💪\n\nCheckout: ${checkoutUrl}\n\nAlso fill this intake form: ${intakeUrl}`;

        await sendText(phone, msg, true);

        return res.status(200).json({ ok: true, action: 'qualified', program: matched.program });
      }
    }

    return res.status(200).json({ ok: true, action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
};
