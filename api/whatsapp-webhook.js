const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText, canSendToLead } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'lean', 'slim', 'lose'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'age'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'transform', 'flagship'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home Shred' },
];

function classifyIntent(text) {
  const lower = (text || '').toLowerCase();
  if (lower === 'stop' || lower === 'unsubscribe') return { action: 'optout' };
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return { action: 'qualify', ...entry };
    }
  }
  return { action: 'unknown' };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile || '';
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text
    });

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', phone, text.slice(0, 200));
    }

    const intent = classifyIntent(text);

    if (intent.action === 'optout') {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
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
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeMsg = hinglish
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (intent.action === 'qualify') {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: intent.program
      }).eq('id', existingLead.id);

      const checkoutBase = 'https://fitnessbymaddyy.exlyapp.com/checkout';
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const qualifyMsg = hinglish
        ? `Great choice! 💪 ${intent.label} program perfect hai tere liye.\n\n📝 Pehle yeh intake form fill kar: ${intakeUrl}\n\n💳 Fir yahan se enroll kar: ${checkoutBase}/${intent.program}`
        : `Great choice! 💪 The ${intent.label} program is perfect for you.\n\n📝 First, fill out this intake form: ${intakeUrl}\n\n💳 Then enroll here: ${checkoutBase}/${intent.program}`;

      const allowed = await canSendToLead(phone);
      if (allowed) {
        await sendText(phone, qualifyMsg);
      }

      return res.status(200).json({ action: 'qualified', program: intent.program });
    }

    const fallbackMsg = hinglish
      ? "Thanks for your message! 🙏 Kya tum fat loss, PCOS, strength, ya 40+ fitness mein interested ho? Ya $20 trial session try karna hai?"
      : "Thanks for your message! 🙏 Are you interested in fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a $20 trial session?";

    const allowed = await canSendToLead(phone);
    if (allowed) {
      await sendText(phone, fallbackMsg);
    }

    return res.status(200).json({ action: 'fallback_reply' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
