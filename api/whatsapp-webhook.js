const { getSupabase } = require('./_lib/supabase');
const { sendMessage, logIncoming } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/mask-phone');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym',
  pcos: 'pcos', hormonal: 'pcos',
  '40': '40plus', menopause: '40plus', joints: '40plus',
  custom: '12wk', '12 week': '12wk', serious: '12wk',
  trial: 'zoom_trial', zoom: 'zoom_trial', 'not sure': 'zoom_trial',
};

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  pcos: 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  zoom_trial: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  zoom_pack: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack',
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.waId;
    const body = payload.text || payload.body || payload.message || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await logIncoming(phone, body);
    console.log(`Incoming from ${maskPhone(phone)}: ${body.slice(0, 80)}`);

    if (isOptOut(body)) {
      const db = getSupabase();
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(body)) {
      await escalateToMaddy(
        'Keyword trigger in message',
        `Phone: ${maskPhone(phone)}\nMessage: ${body.slice(0, 200)}`
      );
    }

    const db = getSupabase();
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await db.from('leads').insert({
        phone,
        name: payload.name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: body,
        last_msg_at: new Date().toISOString(),
        market,
      });

      await sendMessage(
        phone,
        null,
        'welcome_v1',
        false
      );

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const matched = matchProgram(body);
    if (matched && existingLead.status === 'new') {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: matched,
      }).eq('id', existingLead.id);

      const checkoutUrl = CHECKOUT_URLS[matched] || CHECKOUT_URLS['zoom_trial'];
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      await sendMessage(
        phone,
        null,
        'checkout_link',
        false
      );

      return res.status(200).json({
        action: 'qualified',
        program: matched,
        checkoutUrl,
        intakeUrl,
      });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
