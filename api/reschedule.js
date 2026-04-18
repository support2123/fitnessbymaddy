const { notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, phone, date, time, reason, client_id } = req.body;

    if (!name || !phone || !date || !time) {
      return res.status(400).json({ error: 'name, phone, date, and time are required' });
    }

    await notifyMaddy(
      'Reschedule Request',
      `Name: ${name}\nPhone: ${maskPhone(phone)}\nDate: ${date}\nTime: ${time}\nReason: ${reason || 'Not specified'}${client_id ? '\nClient ID: ' + client_id : ''}`
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[reschedule] Error:', err.message);
    return res.status(200).json({ ok: true });
  }
};
