const { getSupabase } = require('../lib/supabase');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation } = require('../lib/escalation');
const { canSendToLead, sendTemplate, sendText, notifyMaddy, logMessage } = require('../lib/whatsapp');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose weight', 'fat', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', 'over 40', '40+', 'forty'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personali', 'personalise'], program: '12wk', label: '12-Week Custom Training' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' }
];

const CHECKOUT_MAP = {
  '6wk_gym': 'shred-6wk',
  '6wk_home': 'shred-6wk-home',
  '12wk': 'custom-12wk',
  'pcos': 'pcos-warrior',
  '40plus': 'forty-plus',
  'zoom_trial': 'zoom-trial',
  'zoom_pack': 'zoom-pack'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = extractPhone(payload);
    const text = extractText(payload);
    const name = extractName(payload);

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const sb = getSupabase();

    await logMessage(phone, 'in', text, null);

    // Opt-out handling
    if (text && /\b(stop|unsubscribe|opt.?out)\b/i.test(text)) {
      await sb.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    // Escalation check
    const esc = needsEscalation(text);
    if (esc.escalate) {
      await notifyMaddy(`Lead ${maskPhone(phone)} said: "${text}" — trigger: ${esc.reason}`);
      return res.json({ action: 'escalated', reason: esc.reason });
    }

    // Check if existing lead
    const { data: existingLead } = await sb
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      await sb.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

      // If already converted/dropped, skip automation
      if (existingLead.status === 'converted') {
        return res.json({ action: 'existing_client' });
      }
      if (existingLead.status === 'dropped') {
        return res.json({ action: 'dropped_lead' });
      }

      // Flow B: Qualification — match keywords to program
      if (existingLead.status === 'new' && text) {
        const matched = matchProgram(text);
        if (matched) {
          await sb.from('leads').update({
            status: 'qualified',
            program_interest: matched.program
          }).eq('id', existingLead.id);

          const market = existingLead.market || detectMarket(phone);
          const checkoutSlug = CHECKOUT_MAP[matched.program] || 'custom-12wk';
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutSlug}`;
          const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

          if (isHinglish(market)) {
            await sendText(phone,
              `Perfect! 🎯 Tumhare liye best program hai — *${matched.label}*\n\n` +
              `Checkout karo: ${checkoutUrl}\n\n` +
              `Aur ye intake form bhi fill karo taaki hum tumhare liye customize kar sakein:\n${intakeUrl}`
            );
          } else {
            await sendText(phone,
              `Perfect! 🎯 The best fit for you is — *${matched.label}*\n\n` +
              `Checkout here: ${checkoutUrl}\n\n` +
              `Also fill out this intake form so we can customize your plan:\n${intakeUrl}`
            );
          }

          return res.json({ action: 'qualified', program: matched.program });
        }
      }

      return res.json({ action: 'existing_lead', status: existingLead.status });
    }

    // Flow A: New lead
    const market = detectMarket(phone);
    const { data: newLead } = await sb.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market
    }).select().single();

    // Send welcome message
    if (isHinglish(market)) {
      await sendTemplate(phone, 'welcome_v1', [name || 'there']);
    } else {
      await sendText(phone,
        `Hi${name ? ' ' + name : ''}! 👋 Maddy's team here.\n\n` +
        `What's your goal — fat loss, PCOS management, strength, 40+ fitness, or would you like to try a trial session first?`
      );
    }

    return res.json({ action: 'new_lead', id: newLead?.id });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function extractPhone(payload) {
  // AiSensy webhook format
  if (payload?.phone) return payload.phone;
  if (payload?.from) return payload.from;
  // Meta Cloud API format
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from) {
    return payload.entry[0].changes[0].value.messages[0].from;
  }
  if (payload?.contacts?.[0]?.wa_id) return payload.contacts[0].wa_id;
  return null;
}

function extractText(payload) {
  if (payload?.text) return payload.text;
  if (payload?.message) return payload.message;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return payload.entry[0].changes[0].value.messages[0].text.body;
  }
  return '';
}

function extractName(payload) {
  if (payload?.name) return payload.name;
  if (payload?.contacts?.[0]?.profile?.name) return payload.contacts[0].profile.name;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name) {
    return payload.entry[0].changes[0].value.contacts[0].profile.name;
  }
  return null;
}

function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    for (const kw of route.keywords) {
      if (lower.includes(kw)) return route;
    }
  }
  return null;
}
