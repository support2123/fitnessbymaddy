const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText, canSendMessage, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_MAP = [
  { keys: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'fat'], program: '6wk_gym', name: '6-Week Burn & Build' },
  { keys: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior' },
  { keys: ['40+', '40 plus', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', name: '40+ Strong' },
  { keys: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', name: '12-Week Custom Program' },
  { keys: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', name: 'Zoom Trial Session' },
  { keys: ['home', 'home workout', 'no gym', 'bodyweight'], program: '6wk_home', name: '6-Week Home Program' }
];

const CHECKOUT_MAP = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keys.some(k => lower.includes(k))) return entry;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.senderPhone || body.waId || body.from;
    const text = body.text || body.message || body.body || '';
    const senderName = body.senderName || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    const lower = text.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', { phone, name: senderName, message: text });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: lead } = await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const allowed = await canSendMessage(phone, false);
      if (allowed) {
        if (isHinglish(market)) {
          await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
        } else {
          await sendTemplate(phone, 'welcome_v1_en', [senderName || 'there']);
        }
      }

      return res.status(200).json({ action: 'new_lead', id: lead?.id, phone: maskPhone(phone) });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const match = matchProgram(text);
    if (match) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: match.program
      }).eq('id', existingLead.id);

      const allowed = await canSendMessage(phone, false);
      if (allowed) {
        const checkoutUrl = CHECKOUT_MAP[match.program];
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;
        const market = existingLead.market || 'GLOBAL';

        if (isHinglish(market)) {
          await sendText(phone,
            `Great choice! ${match.name} program perfect hai aapke liye.\n\n` +
            `Checkout: ${checkoutUrl}\n\n` +
            `Pehle ye form bhar do: ${intakeUrl}\n\n` +
            `Koi bhi question ho toh pooch lo!`
          );
        } else {
          await sendText(phone,
            `Great choice! The ${match.name} program is perfect for you.\n\n` +
            `Checkout: ${checkoutUrl}\n\n` +
            `Please fill this intake form first: ${intakeUrl}\n\n` +
            `Any questions? Just ask!`
          );
        }
      }

      return res.status(200).json({ action: 'qualified', program: match.program, phone: maskPhone(phone) });
    }

    return res.status(200).json({ action: 'message_logged', phone: maskPhone(phone) });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
