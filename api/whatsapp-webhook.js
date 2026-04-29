const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, notifyMaddy, logMessage, canSendMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, isOptOut, getEscalationReason } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'fat'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', '12week', 'serious', 'flagship', 'personali'], program: '12wk', label: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial', price: '$20' },
];

function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, text, name, timestamp } = req.body || {};
    if (!phone || !text) return res.status(400).json({ error: 'Missing phone or text' });

    const db = getSupabase();
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const market = detectMarket(cleanPhone);
    const hinglish = isHinglish(market);

    await logMessage(cleanPhone, 'in', text, null);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', cleanPhone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', cleanPhone);
      console.log('Opt-out processed for', maskPhone(cleanPhone));
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const reason = getEscalationReason(text);
      await notifyMaddy('Escalation needed', `Phone: ${maskPhone(cleanPhone)}\nReason: ${reason}\nMsg: ${text.slice(0, 200)}`);
      return res.status(200).json({ action: 'escalated', reason });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', cleanPhone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .limit(1)
      .single();

    if (existingLead) {
      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      const programMatch = matchProgram(text);
      if (programMatch) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: programMatch.program,
        }).eq('id', existingLead.id);

        if (await canSendMessage(cleanPhone, false)) {
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
          const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

          if (hinglish) {
            await sendTemplate(cleanPhone, 'program_match_hi', [
              existingLead.name || 'there',
              programMatch.label,
              programMatch.price,
              checkoutUrl,
              intakeUrl,
            ], existingLead.name);
          } else {
            await sendTemplate(cleanPhone, 'program_match_en', [
              existingLead.name || 'there',
              programMatch.label,
              programMatch.price,
              checkoutUrl,
              intakeUrl,
            ], existingLead.name);
          }
        }

        return res.status(200).json({ action: 'qualified', program: programMatch.program });
      }

      return res.status(200).json({ action: 'existing_lead' });
    }

    const { data: newLead, error: insertErr } = await db.from('leads').insert({
      phone: cleanPhone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text.slice(0, 500),
      market,
    }).select().single();

    if (insertErr) {
      console.error('Lead insert failed for', maskPhone(cleanPhone), insertErr.message);
      return res.status(500).json({ error: 'Database error' });
    }

    if (hinglish) {
      await sendTemplate(cleanPhone, 'welcome_v1_hi', [
        name || 'there',
      ], name);
    } else {
      await sendTemplate(cleanPhone, 'welcome_v1_en', [
        name || 'there',
      ], name);
    }

    return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
