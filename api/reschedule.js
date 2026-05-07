import { supabase } from './lib/supabase.js';
import { sendTemplate } from './lib/whatsapp.js';
import { logMessage } from './lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const { client_id, preferred_date, preferred_time, reason } = req.body;

  if (!client_id || !preferred_date || !preferred_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    await sendTemplate(client.phone, 'session_rescheduled', [
      client.name || 'there',
      preferred_date,
      preferred_time,
    ]);
    await logMessage(client.phone, 'out', `Rescheduled to ${preferred_date} ${preferred_time}`, 'session_rescheduled');

    return res.status(200).json({ status: 'rescheduled', date: preferred_date, time: preferred_time });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
