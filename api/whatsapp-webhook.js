const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText, notifyMaddy, checkRateLimit } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, needsOptOut } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/pii');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'age', 'senior'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personal', 'personalised'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' },
];

function routeProgram(message) {
  const lower = message.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'WhatsApp webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const message = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.senderName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    console.log(`[Webhook] Message from ${maskPhone(phone)}: ${message.slice(0, 50)}`);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received',
    });

    if (needsOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`[Webhook] Opted out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy(
        'Lead needs human review',
        `Phone: ${maskPhone(phone)}\nMessage: ${message}`
      );
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({ action: 'active_client', note: 'Message logged for active client' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead || existingLead.length === 0) {
      await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const canSend = await checkRateLimit(phone, false);
      if (canSend) {
        await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
      }

      return res.status(200).json({ action: 'new_lead_created' });
    }

    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped', note: 'No further messages' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    const route = routeProgram(message);
    if (route) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: route.program })
        .eq('id', lead.id);

      const canSend = await checkRateLimit(phone, false);
      if (canSend) {
        const checkoutMsg = hinglish
          ? `Great choice! 🎯 ${route.name} (${route.price}) ke liye yahan se start karo:\nhttps://fitnessbymaddyy.exlyapp.com/checkout/${route.program}\n\nIntake form bhi fill karo:\nhttps://fitnessbymaddy.com/intake?lead=${lead.id}`
          : `Great choice! 🎯 Start your ${route.name} (${route.price}) journey here:\nhttps://fitnessbymaddyy.exlyapp.com/checkout/${route.program}\n\nAlso fill out your intake form:\nhttps://fitnessbymaddy.com/intake?lead=${lead.id}`;

        await sendText(phone, checkoutMsg);
      }

      return res.status(200).json({ action: 'qualified', program: route.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (error) {
    console.error('[Webhook Error]', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
