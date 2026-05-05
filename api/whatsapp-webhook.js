const { supabase } = require('./lib/supabase');
const { sendTemplate, sendText, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'weight loss': '6wk_gym', 'lose weight': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'personalised': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial',
  'home': '6wk_home', 'no gym': '6wk_home', 'at home': '6wk_home'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      template_name: null,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    const lower = message.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger', phone, message);
      await sendText(phone, 'Thanks for sharing — Maddy will personally review this and get back to you shortly.');
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          last_msg_at: new Date().toISOString(),
          market,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (market === 'IN') {
        await sendTemplate(phone, 'welcome_v1_hindi', [name || 'there']);
      } else {
        await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      }

      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const program = matchProgram(message);
    if (program && existingLead.status === 'new') {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', existingLead.id);

      const checkoutUrl = CHECKOUT_LINKS[program];
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;
      const market = existingLead.market;

      if (market === 'IN') {
        await sendTemplate(phone, 'program_link_hindi', [
          checkoutUrl,
          intakeUrl
        ]);
      } else {
        await sendTemplate(phone, 'program_link', [
          checkoutUrl,
          intakeUrl
        ]);
      }

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
