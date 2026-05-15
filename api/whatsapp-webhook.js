const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket, isHinglish, maskPhone } = require('../lib/whatsapp');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { jsonResponse, errorResponse } = require('../lib/utils');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym', 'lose': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'pcod': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'premium': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req) {
  if (req.method === 'GET') {
    return jsonResponse({ status: 'webhook active' });
  }
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const body = await req.json();
  const phone = body.phone || body.from || body.senderPhone;
  const message = body.message || body.text || body.body || '';

  if (!phone) return errorResponse('Missing phone number');

  const db = getSupabase();

  // Log incoming message
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: message,
    sent_at: new Date().toISOString(),
    status: 'received'
  });

  // Check opt-out
  if (isOptOut(message)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return jsonResponse({ action: 'opted_out' });
  }

  // Check escalation
  if (needsEscalation(message)) {
    await escalateToMaddy('Keyword trigger in message', { phone: maskPhone(phone), message });
    return jsonResponse({ action: 'escalated' });
  }

  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  // Check if existing lead
  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!existingLead) {
    // FLOW A: New lead
    await db.from('leads').insert({
      phone,
      name: body.name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market
    });

    const templateName = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
    await sendTemplate(phone, templateName, { name: body.name || 'there' });

    return jsonResponse({ action: 'new_lead', market });
  }

  // Update last message timestamp
  await db.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  // FLOW B: Lead qualification
  if (existingLead.status === 'new' || existingLead.status === 'qualified') {
    const program = matchProgram(message);

    if (program) {
      await db.from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', existingLead.id);

      const checkoutLink = CHECKOUT_LINKS[program] || CHECKOUT_LINKS['zoom_trial'];
      const intakeLink = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      await sendTemplate(phone, 'checkout_link', {
        templateParams: [checkoutLink, intakeLink],
        name: existingLead.name || 'there'
      });

      return jsonResponse({ action: 'qualified', program });
    }
  }

  // Check if active client
  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (client) {
    // Active client messaging - log and let support handle
    return jsonResponse({ action: 'client_message', client_id: client.id });
  }

  return jsonResponse({ action: 'message_logged' });
};
