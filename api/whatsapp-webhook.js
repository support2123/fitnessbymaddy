const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendSessionMessage, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, getLanguage } = require('./_lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'burn', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee', 'back pain', 'senior'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial Session', price: '$20' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home Program', price: '$97' }
];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) return entry;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.senderMobile || payload.from || payload.phone;
    const name = payload.senderName || payload.name || '';
    const message = payload.message || payload.text || payload.body || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    console.log(`Incoming from ${maskPhone(phone)}: ${message.slice(0, 50)}`);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy(phone, 'Flagged keyword in message', message);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const market = detectMarket(phone);
    const lang = getLanguage(market);

    if (!existingLead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          market
        })
        .select()
        .single();

      const templateName = lang === 'hinglish' ? 'welcome_v1_hi' : 'welcome_v1_en';
      await sendTemplate(phone, templateName, {
        name: name || 'there',
        templateParams: [name || 'there']
      });

      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const matched = matchProgram(message);

      if (matched) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: matched.program })
          .eq('id', existingLead.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const replyText = lang === 'hinglish'
          ? `Great choice! ${matched.label} (${matched.price}) perfect hai tere goals ke liye.\n\nCheckout: ${checkoutUrl}\n\nIntake form bhi fill karo: ${intakeUrl}`
          : `Great choice! ${matched.label} (${matched.price}) is perfect for your goals.\n\nCheckout: ${checkoutUrl}\n\nAlso fill out your intake form: ${intakeUrl}`;

        await sendSessionMessage(phone, replyText);

        return res.status(200).json({ action: 'qualified', program: matched.program });
      }

      const nudgeText = lang === 'hinglish'
        ? 'Koi tension nahi! Bata — fat loss, PCOS, strength, ya 40+ fitness? Ya pehle ek $20 trial try karna chahte ho?'
        : "No worries! Tell me — are you interested in fat loss, PCOS management, strength training, or 40+ fitness? Or would you like to try a $20 trial session first?";

      await sendSessionMessage(phone, nudgeText);
      return res.status(200).json({ action: 'awaiting_interest' });
    }

    if (existingLead.status === 'qualified') {
      const replyText = lang === 'hinglish'
        ? 'Checkout link mil gaya? Payment ke baad hum turant onboard kar denge!'
        : 'Did you get the checkout link? Once payment is done, we\'ll onboard you right away!';

      await sendSessionMessage(phone, replyText);
      return res.status(200).json({ action: 'follow_up_qualified' });
    }

    return res.status(200).json({ action: 'no_action' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
