const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, canSendToLead, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, classifyEscalation } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Training',
  'zoom_trial': '$20 Zoom Trial Session'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

function routeToProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId || '';
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text
    });

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const type = classifyEscalation(text);
      await notifyMaddy(
        `${type} escalation from ${maskPhone(phone)}`,
        `Phone: ${maskPhone(phone)}\nMessage: ${text}\nType: ${type}`
      );
      const ack = isHinglish(detectMarket(phone))
        ? 'Maddy ko message pahunch gaya hai. Wo jald se jald aapse connect karengi!'
        : 'Your message has been forwarded to Maddy. She will get back to you personally!';
      await sendText(phone, ack);
      return res.json({ action: 'escalated', type });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.json({ action: 'active_client', note: 'Handled by support flow' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead || existingLead.length === 0) {
      await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market
      });

      await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
      return res.json({ action: 'new_lead_greeted' });
    }

    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.json({ action: 'dropped_lead_ignored' });
    }

    const program = routeToProgram(text);
    if (program) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: program,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead.id);

      const programName = PROGRAM_NAMES[program];
      const checkoutLink = CHECKOUT_LINKS[program];
      const intakeLink = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

      const msg = hinglish
        ? `${programName} - bilkul sahi choice! Yahan se checkout karo: ${checkoutLink}\n\nAur ye intake form bhi bhar do: ${intakeLink}`
        : `Great choice! ${programName} is perfect for you.\n\nCheckout here: ${checkoutLink}\n\nAlso fill out your intake form: ${intakeLink}`;

      if (await canSendToLead(phone)) {
        await sendText(phone, msg);
      }

      return res.json({ action: 'qualified', program });
    }

    await supabase.from('leads').update({
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    return res.json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
