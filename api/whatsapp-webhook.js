const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, isOptOut, notifyMaddy } = require('./_lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const sb = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await sb.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      template_name: null
    });

    if (isOptOut(text)) {
      await sb.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy('escalation_keyword', { phone, message: text.slice(0, 200) });
    }

    const { data: existing } = await sb
      .from('leads')
      .select('id, status, program_interest')
      .eq('phone', phone)
      .single();

    if (!existing) {
      const { data: lead } = await sb.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market
      }).select().single();

      const welcomeParams = hinglish
        ? ['Hi! Maddy ki team yahan 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS, strength, or 40+ fitness? Or want to try a trial first?'];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
    }

    if (existing.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await sb.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existing.id);

    if (existing.status === 'new' && !existing.program_interest) {
      const match = qualifyLead(text);

      if (match) {
        await sb.from('leads').update({
          status: 'qualified',
          program_interest: match.program
        }).eq('id', existing.id);

        const checkoutUrl = getCheckoutUrl(match.program);
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existing.id}`;

        const qualifyMsg = hinglish
          ? [`Great choice! ${match.label} perfect hai tere liye. Yeh raha checkout link: ${checkoutUrl} \n\nAur yeh intake form bhi fill karo: ${intakeUrl}`]
          : [`Great choice! ${match.label} is perfect for you. Here's your checkout link: ${checkoutUrl} \n\nAlso fill out this intake form: ${intakeUrl}`];

        await sendTemplate(phone, 'program_qualified', qualifyMsg);

        return res.status(200).json({ action: 'qualified', program: match.program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
