import supabase from './lib/supabase.js';
import { sendTemplate, logIncoming } from './lib/whatsapp.js';
import { detectMarket, isHinglish } from './lib/market.js';
import { needsEscalation, escalateToMaddy } from './lib/escalation.js';

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'mature'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'advanced', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight'], program: '6wk_home', label: '6-Week Home' },
];

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];
const BASE_URL = 'https://www.fitnessbymaddy.com';

function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.senderPhone || '';
    const messageBody = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await logIncoming(phone, messageBody);
    const lower = messageBody.toLowerCase().trim();

    if (STOP_WORDS.some(w => lower.includes(w))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(messageBody)) {
      await escalateToMaddy('Keyword trigger in message', phone, messageBody);
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
        first_msg: messageBody,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeParams = hinglish
        ? ["Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"]
        : ["Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);

      return res.json({ action: 'new_lead', leadId: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: senderName || existingLead.name })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const matched = matchProgram(messageBody);
      if (matched) {
        await supabase.from('leads')
          .update({ status: 'qualified', program_interest: matched.program })
          .eq('id', existingLead.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
        const intakeUrl = `${BASE_URL}/intake.html?lead=${existingLead.id}`;

        const msg = hinglish
          ? [`Great choice! 🔥 ${matched.label} aapke liye perfect hai.\n\n✅ Checkout: ${checkoutUrl}\n📋 Intake form bhi fill karo: ${intakeUrl}`]
          : [`Great choice! 🔥 ${matched.label} is perfect for your goals.\n\n✅ Checkout here: ${checkoutUrl}\n📋 Also fill out your intake form: ${intakeUrl}`];

        await sendTemplate(phone, 'program_match', msg);

        return res.json({ action: 'qualified', program: matched.program });
      }
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
