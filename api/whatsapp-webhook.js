const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, logIncoming } = require('./_lib/whatsapp');
const {
  detectMarket,
  detectProgram,
  needsEscalation,
  isOptOut,
  isHinglish,
  maskPhone,
  programLabel,
  cors,
} = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile || '';
    const body = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logIncoming({ phone, body });

    const db = getSupabase();
    const market = detectMarket(phone);

    if (isOptOut(body)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(body)) {
      await sendWhatsApp({
        phone: process.env.MADDY_PHONE || '+917082478374',
        templateName: 'escalation_alert',
        params: [maskPhone(phone), body.slice(0, 200)],
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: body,
        market,
      });

      const welcomeMsg = isHinglish(market)
        ? 'Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Maddy\'s team here. What\'s your fitness goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        params: [name || 'there'],
        body: welcomeMsg,
      });

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    const program = detectProgram(body);
    if (program && existingLead.status === 'new') {
      await db
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: program,
          last_msg_at: new Date().toISOString(),
        })
        .eq('id', existingLead.id);

      const label = programLabel(program);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const qualMsg = isHinglish(market)
        ? `Great choice! ${label} aapke liye perfect hai. Yahan se checkout karo: ${checkoutUrl}\n\nAur ye form bhi fill kar do: ${intakeUrl}`
        : `Great choice! ${label} is perfect for you. Checkout here: ${checkoutUrl}\n\nAlso fill out this form: ${intakeUrl}`;

      await sendWhatsApp({
        phone,
        templateName: 'program_recommendation',
        params: [name || 'there', label],
        body: qualMsg,
      });

      return res.status(200).json({ action: 'lead_qualified', program });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
