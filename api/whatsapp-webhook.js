const { supabase } = require('./lib/supabase');
const { sendTemplate, sendText } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'pcod': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'flagship': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Flagship Program',
  'zoom_trial': 'Zoom Trial Session',
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/trial',
};

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'webhook active' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId;
    const text = payload.text || payload.message || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
    });

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', phone, text.slice(0, 200));
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString(), first_msg: existingLead.first_msg || text })
        .eq('id', existingLead.id);

      const matched = matchProgram(text);
      if (matched) {
        const market = detectMarket(phone);
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: matched })
          .eq('id', existingLead.id);

        const programName = PROGRAM_NAMES[matched];
        const checkoutLink = CHECKOUT_LINKS[matched];
        const intakeLink = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        if (isHinglish(market)) {
          await sendText(phone,
            `Great choice! ${programName} aapke liye perfect hai.\n\n` +
            `Payment link: ${checkoutLink}\n\n` +
            `Aur yeh intake form bhi fill kar do taaki Maddy aapka plan ready kar sake:\n${intakeLink}`,
            false
          );
        } else {
          await sendText(phone,
            `Great choice! The ${programName} is perfect for you.\n\n` +
            `Payment link: ${checkoutLink}\n\n` +
            `Also fill out this intake form so Maddy can build your plan:\n${intakeLink}`,
            false
          );
        }

        return res.status(200).json({ action: 'qualified', program: matched });
      }

      return res.status(200).json({ action: 'existing_lead' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
        status: 'new',
        source: 'whatsapp',
      })
      .select('id')
      .single();

    if (isHinglish(market)) {
      await sendTemplate(phone, 'welcome_v1', [
        "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      ]);
    } else {
      await sendTemplate(phone, 'welcome_v1', [
        "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"
      ]);
    }

    return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}
