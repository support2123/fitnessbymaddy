const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, logInbound, detectMarket } = require('./_lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { handleCors } = require('./_lib/cors');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'slim': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'pcod': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'joint': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'personalised': '12wk',
  'personalized': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial'
};

const PROGRAM_INFO = {
  '6wk_gym': { name: '6-Week Burn & Build', price: '$97', checkout: '6wk-burn-build' },
  '6wk_home': { name: '6-Week Home Shred', price: '$97', checkout: '6wk-home' },
  'pcos': { name: 'PCOS Warrior', price: '$45', checkout: 'pcos-warrior' },
  '40plus': { name: '40+ Strong', price: '$50', checkout: '40plus-strong' },
  '12wk': { name: '12-Week Custom Program', price: '$200', checkout: '12wk-custom' },
  'zoom_trial': { name: '$20 Zoom Trial', price: '$20', checkout: 'zoom-trial' },
  'zoom_pack': { name: 'Zoom Pack', price: '$150', checkout: 'zoom-pack' }
};

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { phone, message, name } = parseWebhookBody(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await logInbound(phone, message);

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy(
        'Keyword trigger in WhatsApp message',
        `Phone: ${phone.slice(0, 3)}XXX...${phone.slice(-3)} | Msg: ${(message || '').slice(0, 100)}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        market
      }).select().single();

      const isHinglish = market === 'IN';
      const welcomeTemplate = isHinglish ? 'welcome_v1_hi' : 'welcome_v1_en';

      await sendWhatsApp({
        phone,
        templateName: welcomeTemplate,
        params: [name || 'there']
      });

      return res.json({ action: 'new_lead', id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const program = detectProgram(message);
    if (program && existingLead.status === 'new') {
      const info = PROGRAM_INFO[program];
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program
      }).eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${info.checkout}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;
      const market = existingLead.market;

      const msg = market === 'IN'
        ? `${info.name} — ${info.price}! Checkout: ${checkoutUrl}\n\nPehle yeh form bhi fill karo: ${intakeUrl}`
        : `${info.name} — ${info.price}! Checkout: ${checkoutUrl}\n\nPlease also fill this form: ${intakeUrl}`;

      await sendWhatsApp({ phone, body: msg });

      return res.json({ action: 'qualified', program });
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookBody(body) {
  if (!body) return {};
  if (body.response) {
    return {
      phone: body.response.from || body.response.sender,
      message: body.response.text || body.response.body,
      name: body.response.name || body.response.pushName
    };
  }
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    return {
      phone: msg?.from ? `+${msg.from}` : null,
      message: msg?.text?.body,
      name: contact?.profile?.name
    };
  }
  return {
    phone: body.phone || body.from,
    message: body.message || body.text || body.body,
    name: body.name
  };
}
