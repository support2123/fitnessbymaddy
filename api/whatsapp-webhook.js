const { getSupabase } = require('./lib/supabase');
const { sendTemplate, detectMarket, normalizePhone, maskPhone } = require('./lib/whatsapp');
const { shouldEscalate, createEscalation } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym', slim: '6wk_gym', lean: '6wk_gym',
  pcos: 'pcos', hormonal: 'pcos', period: 'pcos',
  '40': '40plus', menopause: '40plus', joints: '40plus', joint: '40plus',
  custom: '12wk', '12 week': '12wk', serious: '12wk', premium: '12wk',
  trial: 'zoom_trial', zoom: 'zoom_trial', 'not sure': 'zoom_trial', try: 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Shred',
  '12wk': '12-Week Custom Flagship',
  pcos: 'PCOS Warrior',
  '40plus': '40+ Strong',
  zoom_trial: '$20 Zoom Trial',
  zoom_pack: 'Zoom Pack'
};

const OPT_OUT_WORDS = ['stop', 'unsubscribe', 'cancel', 'opt out', 'optout'];

function detectProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = getSupabase();
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.from || payload.waId || '');
    const messageBody = payload.text || payload.message || payload.body || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: messageBody
    });

    const lower = messageBody.toLowerCase().trim();
    if (OPT_OUT_WORDS.some(w => lower === w || lower.startsWith(w))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationReason = shouldEscalate(messageBody);
    if (escalationReason) {
      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .single();
      await createEscalation(phone, escalationReason, messageBody, client?.id);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: payload.name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageBody,
        market
      }).select().single();

      const templateName = market === 'IN' ? 'welcome_v1_hi' : 'welcome_v1';
      await sendTemplate(phone, templateName);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const detectedProgram = detectProgram(messageBody);
    if (detectedProgram) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: detectedProgram
      }).eq('id', existingLead.id);

      const market = existingLead.market || 'GLOBAL';
      const programName = PROGRAM_NAMES[detectedProgram] || detectedProgram;
      const templateName = market === 'IN' ? 'program_offer_hi' : 'program_offer';

      await sendTemplate(phone, templateName, [
        existingLead.name || 'there',
        programName
      ]);

      return res.status(200).json({
        action: 'qualified',
        program: detectedProgram,
        lead_id: existingLead.id
      });
    }

    return res.status(200).json({ action: 'message_logged', lead_id: existingLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
