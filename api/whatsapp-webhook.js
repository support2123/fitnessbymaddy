const { supabase } = require('../lib/supabase');
const { sendWhatsApp, canSendMessage } = require('../lib/whatsapp');
const { detectMarket, detectProgram, needsEscalation, isOptOut, maskPhone } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhook(req.body);

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped', opted_out: true }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Trigger keyword in message', `Phone: ${maskPhone(phone)}\nMsg: ${message}`);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: lead } = await supabase.from('leads').insert({
        phone,
        name: name || null,
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
        status: 'new',
      }).select().single();

      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS, strength, or 40+ fitness? Or want to try a trial first?'];

      if (await canSendMessage(phone)) {
        await sendWhatsApp(phone, 'welcome_v1', welcomeParams);
      }

      return res.status(200).json({ action: 'new_lead', lead_id: lead?.id });
    }

    if (existingLead.opted_out) {
      return res.status(200).json({ action: 'ignored_opted_out' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = detectProgram(message);
      if (program) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: program,
        }).eq('id', existingLead.id);

        if (await canSendMessage(phone)) {
          const market = existingLead.market;
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
          const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

          const msgParams = market === 'IN'
            ? [`Great choice! Yeh raha aapka checkout link: ${checkoutUrl}\n\nPlease fill this form too: ${intakeUrl}`]
            : [`Great choice! Here's your checkout link: ${checkoutUrl}\n\nPlease also fill this form: ${intakeUrl}`];

          await sendWhatsApp(phone, 'checkout_link', msgParams);
        }

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhook(body) {
  if (!body) return {};
  if (body.phone && body.message) return body;
  if (body.data) {
    return {
      phone: body.data.customer?.phone || body.data.from,
      message: body.data.message?.text || body.data.text || '',
      name: body.data.customer?.name || body.data.pushName || null,
    };
  }
  return {
    phone: body.from || body.sender || body.phone,
    message: body.text || body.message || body.body || '',
    name: body.name || body.pushName || null,
  };
}
