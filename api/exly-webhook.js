const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy, normalizePhone } = require('../lib/whatsapp');
const { programWeeks, programLabel, validateWebhookSecret } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      if (!validateWebhookSecret(req, process.env.EXLY_WEBHOOK_SECRET)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, name, email, amount, checkout_id,
      product_name, lead_id
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const normalizedPhone = normalizePhone(phone);

    let program = '6wk_gym';
    const pn = (product_name || '').toLowerCase();
    if (pn.includes('12') || pn.includes('flagship') || pn.includes('custom')) program = '12wk';
    else if (pn.includes('pcos')) program = 'pcos';
    else if (pn.includes('40') || pn.includes('strong')) program = '40plus';
    else if (pn.includes('trial') || pn.includes('zoom')) program = 'zoom_trial';
    else if (pn.includes('home')) program = '6wk_home';

    const weeks = programWeeks(program);
    const programEnd = new Date();
    programEnd.setDate(programEnd.getDate() + weeks * 7);

    let resolvedLeadId = lead_id;
    if (!resolvedLeadId) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', normalizedPhone)
        .single();
      if (lead) resolvedLeadId = lead.id;
    }

    if (resolvedLeadId) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', resolvedLeadId);
    }

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: resolvedLeadId || null,
      phone: normalizedPhone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnd.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const templateName = `onboard_${program}`;
    await sendTemplate(normalizedPhone, templateName, [
      name || 'there',
      programLabel(program)
    ]);

    return res.status(200).json({ success: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);

    if (err.message && err.message.includes('payment')) {
      await notifyMaddy('Payment webhook failure', err.message).catch(() => {});
    }

    return res.status(500).json({ error: 'Internal error' });
  }
};
