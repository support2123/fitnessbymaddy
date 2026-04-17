const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { checkAndEscalate } = require('./_lib/escalation');
const { detectMarket, isHinglishMarket } = require('./_lib/market');
const { qualifyLead, getCheckoutUrl } = require('./_lib/qualify');
const { maskPhone } = require('./_lib/mask');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.senderPhone || payload.from;
    const messageText = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const supabase = getSupabase();

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: messageText,
      status: 'received'
    });

    if (/\b(stop|unsubscribe)\b/i.test(messageText)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalated = await checkAndEscalate(phone, messageText, 'Incoming WhatsApp message');
    if (escalated) {
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);

    if (!existingLead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageText,
        market
      }).select().single();

      const welcomeParams = hinglish
        ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Welcome to Fitness by Maddy 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a $20 zoom trial first?'];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

      console.log(`New lead: ${maskPhone(phone)} market=${market}`);
      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const qualification = qualifyLead(messageText);

      if (qualification) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: qualification.program
        }).eq('id', existingLead.id);

        const checkoutUrl = getCheckoutUrl(qualification.program);
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const qualifyParams = hinglish
          ? [
              qualification.programName,
              `$${qualification.price}`,
              checkoutUrl,
              intakeUrl
            ]
          : [
              qualification.programName,
              `$${qualification.price}`,
              checkoutUrl,
              intakeUrl
            ];

        await sendWhatsApp(phone, 'program_match', qualifyParams);

        console.log(`Qualified: ${maskPhone(phone)} → ${qualification.program}`);
        return res.status(200).json({ action: 'qualified', program: qualification.program });
      }
    }

    return res.status(200).json({ action: 'noted' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
