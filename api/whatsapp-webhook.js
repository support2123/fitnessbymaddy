const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, canSendMessage } = require('../lib/whatsapp');
const { maskPhone, detectMarket, isHinglish, classifyIntent, programLabel, cors } = require('../lib/helpers');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.sender;
    const messageBody = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: messageBody,
      status: 'received'
    });

    const intent = classifyIntent(messageBody);

    if (intent === 'OPTOUT') {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (intent === 'ESCALATE') {
      await sendText(MADDY_PHONE,
        `ESCALATION needed!\nFrom: ${maskPhone(phone)}\nMessage: ${messageBody.slice(0, 200)}`
      );
      console.log(`Escalation flagged: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);

      await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageBody,
        last_msg_at: new Date().toISOString(),
        market
      });

      const greeting = isHinglish(market)
        ? [senderName || 'there']
        : [senderName || 'there'];

      await sendTemplate(phone, 'welcome_v1', greeting);
      console.log(`New lead: ${maskPhone(phone)} market=${market}`);
      return res.status(200).json({ action: 'new_lead_greeted' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (intent && existingLead.status === 'new') {
      const programCode = intent;
      const market = existingLead.market || detectMarket(phone);
      const label = programLabel(programCode);

      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: programCode
      }).eq('id', existingLead.id);

      if (!(await canSendMessage(phone))) {
        return res.status(200).json({ action: 'rate_limited' });
      }

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      if (isHinglish(market)) {
        await sendText(phone,
          `Great choice! ${label} bilkul sahi hai tere liye.\n\n` +
          `Checkout: ${checkoutUrl}\n\n` +
          `Pehle ye form bhar de taaki Maddy tera plan bana sake:\n${intakeUrl}`
        );
      } else {
        await sendText(phone,
          `Great choice! ${label} sounds perfect for you.\n\n` +
          `Checkout here: ${checkoutUrl}\n\n` +
          `Please fill this quick form so Maddy can build your plan:\n${intakeUrl}`
        );
      }

      return res.status(200).json({ action: 'qualified', program: programCode });
    }

    return res.status(200).json({ action: 'noted' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
