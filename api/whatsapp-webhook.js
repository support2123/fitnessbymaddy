import supabase from '../lib/supabase.js';
import { sendTemplate, sendText, logIncoming, notifyMaddy } from '../lib/whatsapp.js';
import { detectMarket, isHinglish } from '../lib/market.js';
import { needsEscalation, getEscalationReason } from '../lib/escalation.js';

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'fat', 'lose weight', 'slim'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'aging', 'ageing'],
  '12wk': ['custom', '12 week', 'twelve week', 'serious', 'transform', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'confused'],
};

const PROGRAM_INFO = {
  '6wk_gym': { name: '6-Week Burn & Build', price: '$35' },
  '6wk_home': { name: '6-Week Home Shred', price: '$35' },
  'pcos': { name: 'PCOS Warrior Program', price: '$45' },
  '40plus': { name: '40+ Strong Program', price: '$50' },
  '12wk': { name: '12-Week Custom Flagship', price: '$200' },
  'zoom_trial': { name: 'Zoom Trial Session', price: '$20' },
  'zoom_pack': { name: 'Zoom Session Pack', price: '$80' },
};

function detectProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = '+' + (payload.phone || payload.senderPhone || payload.from || '');
    const message = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || '';

    if (!phone || phone === '+') {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    await logIncoming(phone, message);

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await supabase.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const reason = getEscalationReason(message);
      await notifyMaddy(
        'Lead/Client needs attention',
        `Phone: ${phone}\nMessage: ${message}\nTrigger: ${reason}`
      );
      return res.status(200).json({ action: 'escalated', reason });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString(),
      }).select().single();

      if (hinglish) {
        await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [senderName || 'there']);
      }

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    await supabase.from('leads').update({
      last_msg_at: new Date().toISOString(),
    }).eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const program = detectProgram(message);
    if (program && existingLead.status === 'new') {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', existingLead.id);

      const info = PROGRAM_INFO[program];
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      if (hinglish) {
        await sendText(phone,
          `Great choice! 💪 ${info.name} (${info.price}) perfect hai tere goal ke liye.\n\n` +
          `Checkout: ${checkoutUrl}\n\n` +
          `Pehle ye form bhar do taaki Maddy tera plan personalize kar sake:\n${intakeUrl}`
        );
      } else {
        await sendText(phone,
          `Great choice! 💪 The ${info.name} (${info.price}) is perfect for your goals.\n\n` +
          `Checkout: ${checkoutUrl}\n\n` +
          `Please fill this form first so Maddy can personalise your plan:\n${intakeUrl}`
        );
      }

      return res.status(200).json({ action: 'qualified', program });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      if (needsEscalation(message)) {
        await notifyMaddy(
          'Active client concern',
          `Client: ${existingClient.name} (${phone})\nProgram: ${existingClient.program}\nMessage: ${message}`
        );
      }
      return res.status(200).json({ action: 'active_client_message' });
    }

    return res.status(200).json({ action: 'no_action' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
