const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { MADDY_PHONE, maskPhone } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, new_date, time_slot, reason, client_id } = req.body;

    if (!phone || !new_date || !time_slot) {
      return res.status(400).json({ error: 'Phone, date, and time slot required' });
    }

    const masked = maskPhone(phone);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: `Reschedule request: ${new_date} at ${time_slot}. Reason: ${reason || 'N/A'}`,
      status: 'received'
    });

    await sendWhatsApp({
      phone: MADDY_PHONE,
      templateName: 'reschedule_request',
      params: [masked, new_date, time_slot, (reason || 'N/A').substring(0, 100)],
      body: `Reschedule Request\nClient: ${masked}\nDate: ${new_date}\nTime: ${time_slot}\nReason: ${reason || 'N/A'}`
    });

    return res.status(200).json({ ok: true, message: 'Reschedule request sent' });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Failed to submit reschedule request' });
  }
};
