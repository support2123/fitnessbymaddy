const { supabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { detectMarket, isHinglish, matchProgram, programLabel, cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.senderPhone;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text
    });

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy(
        'Keyword trigger in message',
        `From ${maskPhone(phone)}: "${text.slice(0, 200)}"`
      );
    }

    const { data: existing } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existing) {
      const market = detectMarket(phone);
      await supabase.from('leads').insert({
        phone, name, source: 'whatsapp', status: 'new',
        first_msg: text, market
      });

      const hinglish = isHinglish(market);
      const greeting = hinglish
        ? 'Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Welcome to Fitness by Maddy. What\'s your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

      await sendWhatsApp(phone, 'welcome_v1', {
        name: name || 'there',
        templateParams: [name || 'there']
      });

      return res.status(200).json({ action: 'new_lead', market });
    }

    if (existing.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: name || existing.name })
      .eq('id', existing.id);

    if (existing.status === 'new') {
      const program = matchProgram(text);
      if (program) {
        await supabase.from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existing.id);

        const market = existing.market;
        const hinglish = isHinglish(market);
        const label = programLabel(program);
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existing.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existing.id}`;

        await sendWhatsApp(phone, 'program_offer', {
          name: existing.name || 'there',
          templateParams: [
            existing.name || 'there',
            label,
            checkoutUrl,
            intakeUrl
          ]
        });

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
