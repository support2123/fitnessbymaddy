const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText, logIncoming } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, escalate } = require('./_lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym',
  pcos: 'pcos', hormonal: 'pcos',
  '40': '40plus', menopause: '40plus', joints: '40plus',
  custom: '12wk', '12 week': '12wk', serious: '12wk',
  trial: 'zoom_trial', zoom: 'zoom_trial', 'not sure': 'zoom_trial',
  home: '6wk_home',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  pcos: 'PCOS Warrior',
  '40plus': '40+ Strong',
  zoom_trial: 'Zoom Trial Session',
  zoom_pack: 'Zoom Pack',
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk',
  pcos: 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus',
  zoom_trial: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

function matchProgram(text) {
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
    const phone = '+' + (payload.senderPhone || payload.from || '').replace(/^\+/, '');
    const text = payload.message || payload.text || payload.body || '';
    const senderName = payload.senderName || payload.pushName || '';

    if (!phone || phone === '+') {
      return res.status(400).json({ error: 'No phone number' });
    }

    await logIncoming(phone, text);

    const lowerText = text.toLowerCase().trim();
    if (lowerText === 'stop' || lowerText === 'unsubscribe') {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalate(phone, 'Keyword trigger in message', text.slice(0, 200));
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead && existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: lead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      const welcomeMsg = hinglish
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendTemplate(phone, 'welcome_v1', {
        name: senderName || 'there',
        templateParams: [senderName || 'there'],
      });

      return res.status(200).json({ action: 'new_lead', lead_id: lead?.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = matchProgram(text);
      if (program) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const programName = PROGRAM_NAMES[program];
        const checkoutLink = CHECKOUT_LINKS[program];
        const intakeLink = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const qualifyMsg = hinglish
          ? `Great choice! 🔥 ${programName} — bahut sahi program hai tere liye.\n\n✅ Checkout: ${checkoutLink}\n📋 Intake form bhi fill kardo: ${intakeLink}\n\nPayment ke baad turant onboarding start!`
          : `Great choice! 🔥 ${programName} is perfect for you.\n\n✅ Checkout: ${checkoutLink}\n📋 Please fill the intake form: ${intakeLink}\n\nOnboarding starts immediately after payment!`;

        await sendText(phone, qualifyMsg);
        return res.status(200).json({ action: 'qualified', program });
      }

      const fallbackMsg = hinglish
        ? "Koi baat nahi! Bata — fat loss chahiye, PCOS help, 40+ fitness, ya full custom 12-week program? Ya pehle $20 trial try karein?"
        : "No worries! Tell me — are you looking for fat loss, PCOS help, 40+ fitness, a full custom 12-week program, or would you like to try a $20 trial first?";

      await sendText(phone, fallbackMsg);
      return res.status(200).json({ action: 'awaiting_qualification' });
    }

    if (existingLead.status === 'qualified') {
      const program = existingLead.program_interest;
      const checkoutLink = CHECKOUT_LINKS[program];
      const reminderMsg = hinglish
        ? `Checkout abhi complete karo! 👇\n${checkoutLink}\n\nKoi question hai toh pooch lo!`
        : `Complete your checkout here! 👇\n${checkoutLink}\n\nFeel free to ask any questions!`;

      await sendText(phone, reminderMsg);
      return res.status(200).json({ action: 'checkout_reminder' });
    }

    return res.status(200).json({ action: 'no_action' });
  } catch (err) {
    console.error('Webhook error:', maskPhone(req.body?.senderPhone), err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
