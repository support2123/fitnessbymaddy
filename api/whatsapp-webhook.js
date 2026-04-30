const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, logIncoming, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { qualifyLead, isOptOut } = require('../lib/qualify');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const messageBody = payload.message || payload.text || payload.body || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await logIncoming(phone, messageBody);

    if (isOptOut(messageBody)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageBody)) {
      await escalateToMaddy(
        'Keyword trigger from lead/client',
        `Phone: ${maskPhone(phone)}\nMessage: ${messageBody.slice(0, 200)}`
      );
    }

    const { data: existing } = await supabase
      .from('leads')
      .select('id, status, name')
      .eq('phone', phone)
      .single();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existing) {
      const { data: lead } = await supabase
        .from('leads')
        .insert({
          phone,
          source: 'whatsapp',
          status: 'new',
          first_msg: messageBody,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      const welcomeMsg = hinglish
        ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendTemplate(phone, 'welcome_v1', [welcomeMsg]);

      return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existing.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existing.status === 'new') {
      const match = qualifyLead(messageBody);

      if (match) {
        await supabase
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: match.program,
          })
          .eq('phone', phone);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existing.id}`;

        const qualifyMsg = hinglish
          ? `Great choice! ${match.name} program ($${match.price}) perfect rahega tere liye.\n\nCheckout: ${checkoutUrl}\n\nPehle ye intake form bhar do: ${intakeUrl}`
          : `Great choice! The ${match.name} program ($${match.price}) would be perfect for you.\n\nCheckout: ${checkoutUrl}\n\nPlease fill out this intake form first: ${intakeUrl}`;

        await sendText(phone, qualifyMsg);

        return res.status(200).json({ action: 'qualified', program: match.program });
      }

      const clarifyMsg = hinglish
        ? "Got it! Mujhe thoda aur batao — fat loss chahiye, PCOS help, 40+ fitness, ya full 12-week custom program? Ya $20 trial se start karna hai?"
        : "Got it! Tell me more — are you looking for fat loss, PCOS support, 40+ fitness, or a full 12-week custom program? Or start with a $20 trial?";

      await sendText(phone, clarifyMsg);
      return res.status(200).json({ action: 'clarification_sent' });
    }

    return res.status(200).json({ action: 'noted' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
