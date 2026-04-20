const supabase = require('../lib/supabase');
const { notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, date, time, reason } = req.body;

    if (!phone || !date || !time) {
      return res.status(400).json({ error: 'Phone, date, and time are required' });
    }

    const cleanPhone = phone.replace(/\D/g, '');

    const { data: client } = await supabase
      .from('clients')
      .select('name, program')
      .eq('phone', cleanPhone)
      .eq('status', 'active')
      .single();

    await notifyMaddy(
      'Reschedule Request',
      `Client: ${client?.name || maskPhone(cleanPhone)}\nPhone: ${maskPhone(cleanPhone)}\nProgram: ${client?.program || 'Unknown'}\nRequested: ${date} at ${time}\nReason: ${reason || 'Not provided'}`
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
