const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./lib/market');
const { needsEscalation, isOptOut } = require('./lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'fat'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', '$20']
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const slugs = {
    '6wk_gym': '6-week-burn-build',
    '6wk_home': '6-week-home',
    'pcos': 'pcos-warrior',
    '40plus': '40plus-strong',
    '12wk': '12-week-flagship',
    'zoom_trial': 'zoom-trial'
  };
  const slug = slugs[program] || program;
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slug}`;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

  try {
    const { phone, message: msgBody, name: senderName } = parseWebhookPayload(req.body);

    if (!phone || !msgBody) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: msgBody
    });

    if (isOptOut(msgBody)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = needsEscalation(msgBody);
    if (esc.escalate) {
      await notifyMaddy(
        `Escalation trigger: "${esc.trigger}"`,
        `From: ${maskPhone(phone)}\nMessage: ${msgBody}`
      );
      return res.status(200).json({ action: 'escalated', trigger: esc.trigger });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: lead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName || null,
          source: 'whatsapp',
          status: 'new',
          first_msg: msgBody,
          last_msg_at: new Date().toISOString(),
          market
        })
        .select()
        .single();

      const welcomeMsg = hinglish
        ? "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Welcome to Fitness by Maddy. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        body: welcomeMsg,
        params: [senderName || 'there']
      });

      return res.status(200).json({ action: 'new_lead', lead_id: lead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const program = matchProgram(msgBody);
    if (program && existingLead.status === 'new') {
      await supabase
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: program
        })
        .eq('id', existingLead.id);

      const checkoutUrl = getCheckoutUrl(program);
      const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const qualifyMsg = hinglish
        ? `Great choice! Yeh raha checkout link: ${checkoutUrl}\n\nAur pehle yeh form fill karo toh hum tumhare liye better plan bana sake: ${intakeUrl}`
        : `Great choice! Here's your checkout link: ${checkoutUrl}\n\nPlease also fill out this intake form so we can build the best plan for you: ${intakeUrl}`;

      await sendWhatsApp({
        phone,
        body: qualifyMsg,
        isClient: false
      });

      return res.status(200).json({ action: 'qualified', program });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      await notifyMaddy(
        'Client message needs attention',
        `Client: ${existingClient.name || maskPhone(phone)}\nProgram: ${existingClient.program}\nMessage: ${msgBody}`
      );
      return res.status(200).json({ action: 'client_message_forwarded' });
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (!body) return {};

  if (body.entry && body.entry[0]) {
    const change = body.entry[0].changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (msg) {
      return {
        phone: msg.from,
        message: msg.text?.body || '',
        name: change.contacts?.[0]?.profile?.name || ''
      };
    }
  }

  return {
    phone: body.phone || body.mobile || body.from,
    message: body.message || body.text || body.body || '',
    name: body.name || body.sender_name || ''
  };
}
