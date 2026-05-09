const { getSupabase } = require('./lib/supabase');
const { corsHeaders, parseBody } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const { name, phone, preferred_date, preferred_time, reason } = body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'name and phone required' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: `[RESCHEDULE] Name: ${name} | Date: ${preferred_date} | Time: ${preferred_time} | Reason: ${reason || 'N/A'}`,
      template_name: 'reschedule_request',
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    await escalateToMaddy(
      'Reschedule request',
      `Client: ${name}\nPhone: ${phone}\nPreferred date: ${preferred_date}\nPreferred time: ${preferred_time}\nReason: ${reason || 'Not provided'}`
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
