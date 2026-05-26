const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, canSendToLead, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, classifyEscalation } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym',
  pcos: 'pcos', hormonal: 'pcos',
  '40': '40plus', menopause: '40plus', joints: '40plus',
  custom: '12wk', '12 week': '12wk', serious: '12wk',
  trial: 'zoom_trial', zoom: 'zoom_trial', 'not sure': 'zoom_trial'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  pcos: 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  zoom_trial: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  zoom_pack: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

function routeToProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'];
    if (challenge) return res.status(200).send(challenge);
    return res.status(200).json({ status: 'webhook active' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const payload = req.body;

  const phone = payload.mobile || payload.senderMobile || payload.from;
  const message = payload.message || payload.text || payload.body || '';
  const senderName = payload.senderName || payload.name || '';

  if (!phone) return res.status(400).json({ error: 'No phone in payload' });

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: message
  });

  const lower = message.toLowerCase().trim();
  if (lower === 'stop' || lower === 'unsubscribe') {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(message)) {
    const type = classifyEscalation(message);
    await notifyMaddy(
      `${type} from ${maskPhone(phone)}`,
      `Message: "${message.slice(0, 200)}"\nPhone: ${phone}`
    );
    const market = detectMarket(phone);
    const ack = isHinglish(market)
      ? 'Dhanyavaad! Maddy ki team aapko jaldi reply karegi. Kuch bhi health-related ho toh please apne doctor se zaroor consult karein.'
      : 'Thank you! Maddy\'s team will get back to you shortly. If this is health-related, please also consult your doctor.';
    await sendText(phone, ack);
    return res.status(200).json({ action: 'escalated', type });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const { data: existingClient } = await db
    .from('clients')
    .select('*')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (existingClient) {
    await notifyMaddy(
      `Active client message from ${maskPhone(phone)}`,
      `Client: ${existingClient.name || 'Unknown'}\nProgram: ${existingClient.program}\nMessage: "${message.slice(0, 200)}"`
    );
    return res.status(200).json({ action: 'forwarded_to_maddy' });
  }

  if (!existingLead) {
    const market = detectMarket(phone);
    await db.from('leads').insert({
      phone,
      name: senderName || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market
    });

    await sendTemplate(phone, 'welcome_v1', {
      name: senderName || 'there',
      templateParams: [senderName || 'there']
    });

    return res.status(200).json({ action: 'new_lead_welcomed' });
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'lead_dropped_ignored' });
  }

  await db.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  const program = routeToProgram(message);

  if (program) {
    const market = existingLead.market || detectMarket(phone);
    await db.from('leads')
      .update({ status: 'qualified', program_interest: program })
      .eq('id', existingLead.id);

    const checkoutUrl = CHECKOUT_LINKS[program] || CHECKOUT_LINKS['zoom_trial'];
    const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

    if (isHinglish(market)) {
      await sendText(phone,
        `Bahut badhiya choice! Yeh raha aapka checkout link:\n${checkoutUrl}\n\nAur yeh intake form bhar do taaki Maddy aapke liye best plan bana sake:\n${intakeUrl}`
      );
    } else {
      await sendText(phone,
        `Great choice! Here's your checkout link:\n${checkoutUrl}\n\nPlease also fill this intake form so Maddy can build the best plan for you:\n${intakeUrl}`
      );
    }

    return res.status(200).json({ action: 'qualified', program });
  }

  const market = existingLead.market || detectMarket(phone);
  if (isHinglish(market)) {
    await sendText(phone,
      'Aapka goal kya hai? Fat loss, PCOS management, 40+ fitness, ya 12-week custom program? Ya pehle $20 ka trial try karna hai?'
    );
  } else {
    await sendText(phone,
      'What\'s your goal? Fat loss, PCOS management, 40+ fitness, or a 12-week custom program? Or would you like to try a $20 trial first?'
    );
  }

  return res.status(200).json({ action: 'prompted_for_goal' });
};
