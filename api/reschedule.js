const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, date, time, reason } = req.body;

    if (!client_id || !date || !time) {
      return res.status(400).json({ error: 'client_id, date, and time required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    await escalateToMaddy('Reschedule request', {
      phone: client.phone,
      message: `${client.name} wants to reschedule to ${date} at ${time}. Reason: ${reason || 'Not provided'}`,
    });

    return res.status(200).json({ success: true, message: 'Reschedule request submitted' });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
