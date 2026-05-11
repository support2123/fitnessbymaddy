const { getSupabase } = require('./lib/supabase');
const { sendMessage } = require('./lib/whatsapp');
const { logMessage } = require('./lib/ratelimit');

const MADDY_PHONE = '917082478374';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { client_id, name, session_type, original_date, new_date, new_time, reason } = req.body;

  if (!new_date || !new_time || !session_type) {
    return res.status(400).json({ error: 'new_date, new_time, and session_type required' });
  }

  const db = getSupabase();

  await db.from('messages').insert({
    phone: client_id || 'unknown',
    direction: 'in',
    body: `Reschedule request: ${session_type} → ${new_date} ${new_time}`,
    template_name: 'reschedule',
    sent_at: new Date().toISOString(),
    status: 'received',
  });

  await sendMessage(MADDY_PHONE,
    `📅 Reschedule request from ${name || 'Client'}:\n` +
    `Session: ${session_type}\n` +
    `New: ${new_date} at ${new_time}\n` +
    (reason ? `Reason: ${reason}` : '')
  );

  return res.status(200).json({ success: true });
};
