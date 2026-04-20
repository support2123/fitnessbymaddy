import { supabase } from '../lib/supabase.js';
import { sendTemplate, logIncoming } from '../lib/whatsapp.js';
import { detectMarket, isHinglish } from '../lib/market.js';
import { needsEscalation, buildEscalationAlert } from '../lib/escalation.js';
import { maskPhone } from '../lib/mask.js';

const PROGRAM_ROUTES = [
  { keys: ['fat loss', 'weight loss', 'weight', 'shred', 'lose fat', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keys: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keys: ['40', 'menopause', 'joints', 'joint pain', '40+', 'forty'], program: '40plus', label: '40+ Strong' },
  { keys: ['custom', '12 week', '12wk', 'serious', 'flagship', 'advanced'], program: '12wk', label: '12-Week Flagship' },
  { keys: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keys: ['home', 'no gym', 'home workout', 'bodyweight'], program: '6wk_home', label: '6-Week Home' },
];

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'];

function classifyIntent(text) {
  const lower = text.toLowerCase().trim();

  if (STOP_WORDS.some((w) => lower.includes(w))) return { intent: 'optout' };

  for (const route of PROGRAM_ROUTES) {
    if (route.keys.some((k) => lower.includes(k))) {
      return { intent: 'program', ...route };
    }
  }

  return { intent: 'unknown' };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;

    const phone = payload.senderPhone || payload.from || payload.waId;
    const name = payload.senderName || payload.profile?.name || null;
    const message = payload.message || payload.text?.body || payload.body || '';

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;
    const market = detectMarket(normalizedPhone);
    const hinglish = isHinglish(market);

    await logIncoming(normalizedPhone, message);

    if (needsEscalation(message)) {
      const alert = buildEscalationAlert({ phone: normalizedPhone, name }, message);
      await sendTemplate(alert.phone, 'escalation_alert', [
        name || 'Unknown',
        maskPhone(normalizedPhone),
        message.slice(0, 150),
      ]);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (!existingLead) {
      await supabase.from('leads').insert({
        phone: normalizedPhone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const welcomeParams = hinglish
        ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Welcome to Fitness by Maddy 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

      await sendTemplate(normalizedPhone, 'welcome_v1', welcomeParams);

      console.log(`New lead: ${maskPhone(normalizedPhone)} [${market}]`);
      return res.status(200).json({ status: 'new_lead_created' });
    }

    if (existingLead.status === 'dropped') {
      const { intent } = classifyIntent(message);
      if (intent === 'optout') {
        return res.status(200).json({ status: 'already_opted_out' });
      }
      await supabase
        .from('leads')
        .update({ status: 'new', last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);
    }

    const { intent, program, label } = classifyIntent(message);

    if (intent === 'optout') {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);
      console.log(`Opted out: ${maskPhone(normalizedPhone)}`);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (intent === 'program') {
      await supabase
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: program,
          last_msg_at: new Date().toISOString(),
        })
        .eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const msgParams = hinglish
        ? [label, checkoutUrl, intakeUrl]
        : [label, checkoutUrl, intakeUrl];

      await sendTemplate(normalizedPhone, 'program_offer', msgParams);

      console.log(`Qualified: ${maskPhone(normalizedPhone)} → ${label}`);
      return res.status(200).json({ status: 'qualified', program });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ status: 'received' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
