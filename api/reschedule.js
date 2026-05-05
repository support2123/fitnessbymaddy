const { supabase } = require('./_lib/supabase');
const { notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, name, preferred_date, preferred_time, reason } = req.body;

    if (!phone || !preferred_date || !preferred_time) {
      return res.status(400).json({ error: 'Phone, date, and time required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id, name, program')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    await notifyMaddy(
      'Reschedule Request',
      `Client: ${name || maskPhone(phone)}\nProgram: ${client?.program || 'Unknown'}\nNew date: ${preferred_date} at ${preferred_time}\nReason: ${reason || 'Not provided'}`
    );

    return res.status(200).json({ success: true, message: 'Reschedule request submitted' });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(200).json({ success: true, message: 'Request received' });
  }
};
