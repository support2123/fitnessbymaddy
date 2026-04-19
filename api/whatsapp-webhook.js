const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, getEscalationReason, escalateToMaddy } = require('../lib/escalation');
const { canSendMessage } = require('../lib/rate-limit');
const { maskPhone } = require('../lib/mask-phone');

const PROGRAM_MAP = {
  fat_loss: { keywords: ['fat loss', 'weight loss', 'shred', 'weight', 'slim', 'lean'], program: '6wk_gym', name: '6-Week Burn & Build', price: 97 },
  pcos: { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  fortyplus: { keywords: ['40', 'forty', 'menopause', 'joints', 'joint'], program: '40plus', name: '40+ Strong', price: 50 },
  flagship: { keywords: ['custom', '12 week', 'serious', 'advanced', 'premium'], program: '12wk', name: '12-Week Flagship', price: 200 },
  trial: { keywords: ['trial', 'zoom', 'not sure', 'try', 'confused'], program: 'zoom_trial', name: 'Zoom Trial', price: 20 },
};

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const [key, info] of Object.entries(PROGRAM_MAP)) {
    if (info.keywords.some((kw) => lower.includes(kw))) return { key, ...info };
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'fitnessbymaddy-whatsapp' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.sender?.phone;
    const text = payload.text || payload.message?.text || payload.body || '';
    const name = payload.name || payload.sender?.name || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      template_name: null,
    });

    const lower = text.toLowerCase().trim();

    if (OPT_OUT_KEYWORDS.some((kw) => lower.includes(kw))) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const reasons = getEscalationReason(text);
      await escalateToMaddy(phone, reasons.join(', '), text);
      console.log(`Escalated: ${maskPhone(phone)} — ${reasons.join(', ')}`);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);

      await supabase.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const hinglish = isHinglish(market);
      if (hinglish) {
        await sendTemplate(phone, 'welcome_v1', [
          name || 'there',
        ]);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [
          name || 'there',
        ]);
      }

      return res.status(200).json({ action: 'new_lead', market });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: name || existingLead.name })
      .eq('id', existingLead.id);

    const matched = matchProgram(text);

    if (matched && existingLead.status === 'new') {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return res.status(200).json({ action: 'rate_limited' });
      }

      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: matched.program })
        .eq('id', existingLead.id);

      const market = existingLead.market || detectMarket(phone);
      const hinglish = isHinglish(market);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      if (hinglish) {
        await sendText(phone,
          `Great choice! 🔥 ${matched.name} program ($${matched.price}) perfect hai tumhare liye.\n\n` +
          `💳 Payment link: ${checkoutUrl}\n\n` +
          `📋 Intake form bhi fill karo: ${intakeUrl}\n\n` +
          `Koi doubt ho toh pooch lo! 💪`
        );
      } else {
        await sendText(phone,
          `Great choice! 🔥 The ${matched.name} program ($${matched.price}) is perfect for you.\n\n` +
          `💳 Payment link: ${checkoutUrl}\n\n` +
          `📋 Please fill out the intake form: ${intakeUrl}\n\n` +
          `Any questions? We're here to help! 💪`
        );
      }

      return res.status(200).json({ action: 'qualified', program: matched.program });
    }

    return res.status(200).json({ action: 'noted' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
