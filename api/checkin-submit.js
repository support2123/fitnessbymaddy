const { getSupabase } = require('../lib/supabase');
const { checkEscalation, maskPhone } = require('../lib/escalation');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photo_urls
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  const { data: client, error: clientErr } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (clientErr || !client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  // Check for escalation in issues text
  if (issues) {
    const esc = checkEscalation(issues);
    if (esc.escalate) {
      await db.from('escalations').insert({
        phone: client.phone,
        client_id: client.id,
        reason: esc.reason,
        trigger_message: issues
      });
      await notifyMaddy(
        `Check-in concern: ${esc.reason}`,
        `Client: ${maskPhone(client.phone)}\nWeek ${week_no}\nIssue: "${issues}"`
      );
    }
  }

  // Update or insert checkin
  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', parseInt(week_no))
    .single();

  const checkinData = {
    client_id,
    week_no: parseInt(week_no),
    form_submitted_at: new Date().toISOString(),
    weight: parseFloat(weight) || null,
    waist: parseFloat(waist) || null,
    compliance_score: parseInt(compliance_score) || null,
    energy: parseInt(energy) || null,
    issues: issues || null,
    photos_urls: photo_urls || []
  };

  if (existing) {
    await db.from('checkins').update(checkinData).eq('id', existing.id);
  } else {
    await db.from('checkins').insert(checkinData);
  }

  // Trigger program generation for 12-week clients
  if (client.program === '12wk') {
    const baseUrl = `https://${req.headers.host}`;
    fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
      },
      body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
    }).catch(() => {});
  }

  return res.status(200).json({ success: true, message: 'Check-in submitted' });
};
