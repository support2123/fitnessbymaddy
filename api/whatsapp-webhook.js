const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('./_lib/market');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk': ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'burn', 'lean', 'slim'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'over 40', 'above 40'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'flagship', 'full program', 'personalised'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', '$20', 'cheap']
};

const CHECKOUT_URLS = {
  '6wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = extractPhone(payload);
    const text = extractText(payload);

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text || '',
      status: 'received'
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const { data: lead } = await db.from('leads').select('name').eq('phone', phone).single();
      await escalateToMaddy('Keyword trigger in message', {
        phone,
        name: lead?.name,
        message: text
      });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client_message', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const market = detectMarket(phone);

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        first_msg: text,
        market,
        status: 'new'
      }).select().single();

      const templateName = isHinglishMarket(market) ? 'welcome_v1_hi' : 'welcome_v1';
      await sendTemplate(phone, templateName, [newLead?.name || '']);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const matched = matchProgram(text);
    if (matched) {
      await db.from('leads')
        .update({ status: 'qualified', program_interest: matched })
        .eq('id', existingLead.id);

      const checkoutUrl = CHECKOUT_URLS[matched];
      const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const templateName = isHinglishMarket(market) ? `program_${matched}_hi` : `program_${matched}`;
      await sendTemplate(phone, templateName, [
        existingLead.name || '',
        checkoutUrl,
        intakeUrl
      ]);

      return res.status(200).json({ action: 'qualified', program: matched });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function extractPhone(payload) {
  if (payload?.phone) return payload.phone.replace(/[^0-9]/g, '');
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from) {
    return payload.entry[0].changes[0].value.messages[0].from;
  }
  if (payload?.waId) return payload.waId.replace(/[^0-9]/g, '');
  if (payload?.destination) return payload.destination.replace(/[^0-9]/g, '');
  return null;
}

function extractText(payload) {
  if (payload?.message?.text) return payload.message.text;
  if (payload?.text) return payload.text;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return payload.entry[0].changes[0].value.messages[0].text.body;
  }
  if (payload?.body) return payload.body;
  return '';
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}
