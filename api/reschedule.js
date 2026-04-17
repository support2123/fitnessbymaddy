const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { client_id, name, phone, preferred_date, preferred_time, reason } = req.body;

  if (!name || !phone || !preferred_date || !preferred_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const supabase = getSupabase();
    const maddyPhone = process.env.MADDY_PHONE;

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: `Reschedule request: ${preferred_date} at ${preferred_time}. Reason: ${reason || 'not specified'}`,
    });

    if (maddyPhone) {
      await sendWhatsApp({
        phone: maddyPhone,
        body: `Reschedule request from ${name} (${maskPhone(phone)}):\nDate: ${preferred_date}\nTime: ${preferred_time}\nReason: ${reason || 'not specified'}`,
        params: { name: 'Maddy' },
      });
    }

    console.log(`Reschedule: ${maskPhone(phone)} → ${preferred_date} ${preferred_time}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
