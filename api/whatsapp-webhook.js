const { getClient } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');
const { needsEscalation, isOptOut, classifyProgram } = require('./_lib/escalation');
const { notifyMaddy, buildEscalationDetails } = require('./_lib/notify');

const PROGRAM_INFO = {
  '6wk_gym':    { name: '6-Week Burn & Build (Gym)', price: 97, template: 'offer_6wk_gym' },
  '6wk_home':   { name: '6-Week Burn & Build (Home)', price: 97, template: 'offer_6wk_home' },
  'pcos':       { name: 'PCOS Warrior Program', price: 45, template: 'offer_pcos' },
  '40plus':     { name: '40+ Strong Program', price: 50, template: 'offer_40plus' },
  '12wk':       { name: '12-Week Custom Flagship', price: 200, template: 'offer_12wk' },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, template: 'offer_zoom_trial' },
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sb = getClient();

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId || '';
    const text = payload.text || payload.body || payload.message || '';
    const senderName = payload.senderName || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'no phone' });

    // Log inbound message
    await sb.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    // Check opt-out
    if (isOptOut(text)) {
      await sb.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check escalation
    if (needsEscalation(text)) {
      const details = buildEscalationDetails(phone, text, 'keyword match');
      await notifyMaddy('Lead Escalation', details);
    }

    // Look up existing lead
    const { data: existing } = await sb
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    // Check if already a client
    const { data: existingClient } = await sb
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      // Active client messaging — just log, don't run lead flow
      return res.status(200).json({ action: 'client_message_logged' });
    }

    if (!existing) {
      // FLOW A — NEW LEAD
      const market = detectMarket(phone);
      const { data: lead } = await sb.from('leads').insert({
        phone,
        name: senderName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      // Send welcome template
      await sendTemplate(phone, 'welcome_v1', [senderName || 'there'], true);

      // Schedule nudge: 2hr and 24hr are handled by the nudge cron
      return res.status(200).json({ action: 'new_lead', leadId: lead.id });
    }

    // Existing lead — update last message
    await sb.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existing.id);

    if (existing.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    // FLOW B — LEAD QUALIFICATION
    const program = classifyProgram(text);
    if (program) {
      const info = PROGRAM_INFO[program];
      await sb.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', existing.id);

      // Send program offer + intake link
      const market = existing.market || detectMarket(phone);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existing.id}`;

      await sendTemplate(phone, info.template, [
        senderName || existing.name || 'there',
        info.name,
        `$${info.price}`,
        checkoutUrl,
        intakeUrl,
      ], true);

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
