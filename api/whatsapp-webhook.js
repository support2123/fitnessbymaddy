const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, sendTemplate, maskPhone } = require('../lib/whatsapp');
const { detectMarket, getWelcomeMsg } = require('../lib/market');
const { needsEscalation, classifyProgram, isOptOut } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

  try {
    const { phone, message, name, senderName } = req.body;
    const contactName = name || senderName || 'Unknown';
    const body = message || req.body.text || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body,
      sent_at: new Date().toISOString()
    });

    if (isOptOut(body)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(body)) {
      const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
      await sendWhatsApp(
        maddyPhone,
        `ESCALATION from ${maskPhone(phone)}: "${body.slice(0, 200)}"`,
        'escalation_alert'
      );
      return res.json({ action: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: lead } = await supabase.from('leads').insert({
        phone,
        name: contactName,
        source: 'whatsapp',
        status: 'new',
        first_msg: body,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      }).select().single();

      const welcomeMsg = getWelcomeMsg(market);
      await sendWhatsApp(phone, welcomeMsg, 'welcome_v1');

      return res.json({ action: 'new_lead', lead_id: lead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const match = classifyProgram(body);
    if (match) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: match.program
      }).eq('id', existingLead.id);

      const market = existingLead.market || 'GLOBAL';
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const msg = market === 'IN'
        ? `Great choice! ${match.name} program ($${match.price}). Yahan se checkout karo: ${checkoutUrl}\n\nAur ye intake form bhi fill karo: ${intakeUrl}`
        : `Great choice! ${match.name} program ($${match.price}). Checkout here: ${checkoutUrl}\n\nAlso fill out this intake form: ${intakeUrl}`;

      await sendWhatsApp(phone, msg);
      return res.json({ action: 'qualified', program: match.program });
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
