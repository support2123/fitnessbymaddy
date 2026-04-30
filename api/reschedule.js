const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, name, phone, preferred_date, preferred_time, reason } = req.body;

    if (!name || !phone || !preferred_date || !preferred_time) {
      return res.status(400).json({ error: 'name, phone, preferred_date, and preferred_time required' });
    }

    const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '');
    const db = getSupabase();

    await db.from('reschedule_requests').insert({
      client_id: client_id || null,
      name,
      phone: normalizedPhone,
      preferred_date,
      preferred_time,
      reason: reason || null,
      status: 'pending',
      created_at: new Date().toISOString()
    });

    await escalateToMaddy({
      reason: 'Reschedule request',
      phone: normalizedPhone,
      clientName: name,
      messageText: `Date: ${preferred_date}, Time: ${preferred_time}. Reason: ${reason || 'Not specified'}`
    });

    await sendWhatsApp({
      phone: normalizedPhone,
      templateName: 'reschedule_confirm',
      body: `Hi ${name}! Your reschedule request for ${preferred_date} at ${preferred_time} has been received. We'll confirm your new slot on WhatsApp shortly! 📋`,
      params: { name, templateParams: [name, preferred_date, preferred_time] }
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
