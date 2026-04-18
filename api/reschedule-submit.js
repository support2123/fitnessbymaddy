const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, date, time_slot, reason } = req.body;
    if (!phone || !date || !time_slot) {
      return res.status(400).json({ error: 'phone, date, and time_slot required' });
    }

    let normalizedPhone = phone.replace(/[^0-9+]/g, '');
    if (!normalizedPhone.startsWith('+')) normalizedPhone = '+' + normalizedPhone;

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found for this phone number' });
    }

    await supabase.from('messages').insert({
      phone: normalizedPhone,
      direction: 'in',
      body: JSON.stringify({ type: 'reschedule', date, time_slot, reason }),
      template_name: 'reschedule_request',
    });

    await sendTemplate(process.env.MADDY_PHONE, 'reschedule_alert', [
      client.name || maskPhone(normalizedPhone),
      date,
      time_slot,
      reason || 'No reason given',
    ]);

    return res.status(200).json({ ok: true, message: 'Reschedule request sent' });

  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
