const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendTextMessage } = require('./_lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('./_lib/market');
const { needsEscalation, escalate } = require('./_lib/escalation');

const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', name: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'over 40', '40+'], program: '40plus', name: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', name: '12-Week Custom' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', name: '6-Week Home' },
];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) return entry;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'WhatsApp webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const messageBody = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.senderName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const cleanPhone = phone.replace(/[^0-9]/g, '');

    await supabase.from('messages').insert({
      phone: cleanPhone,
      direction: 'in',
      body: messageBody
    });

    if (/^(stop|unsubscribe|opt.?out)$/i.test(messageBody.trim())) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', cleanPhone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(messageBody);
    if (escalationKeyword) {
      await escalate(cleanPhone, escalationKeyword, messageBody);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', cleanPhone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .maybeSingle();

    const market = detectMarket(cleanPhone);

    if (!existingLead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone: cleanPhone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: messageBody,
          last_msg_at: new Date().toISOString(),
          market
        })
        .select()
        .single();

      await sendTemplate(cleanPhone, 'welcome_v1', [senderName || 'there']);
      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const matched = matchProgram(messageBody);
    if (matched) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: matched.program })
        .eq('id', existingLead.id);

      const hinglish = isHinglishMarket(market);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      await sendTemplate(cleanPhone, 'program_match', [
        senderName || existingLead.name || 'there',
        matched.name,
        checkoutUrl
      ]);

      if (matched.program === '12wk' || matched.program === 'pcos' || matched.program === '40plus') {
        await sendTemplate(cleanPhone, 'intake_form', [intakeUrl]);
      }

      return res.status(200).json({ action: 'qualified', program: matched.program });
    }

    return res.status(200).json({ action: 'reply_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
