const { getSupabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/escalation');
const { notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  // Verify client
  const { data: client } = await db.from('clients').select('*').eq('id', client_id).single();
  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Check for escalation in issues
  if (issues) {
    const esc = needsEscalation(issues);
    if (esc.escalate) {
      await notifyMaddy(
        'Check-in Health Flag',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nIssues: ${issues}\nTriggers: ${esc.reasons.join(', ')}`
      );
    }
  }

  // Upsert check-in
  const { data: checkin, error } = await db.from('checkins').upsert({
    client_id,
    week_no: parseInt(week_no),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photos_urls || [],
    form_submitted_at: new Date().toISOString()
  }, { onConflict: 'client_id,week_no' }).select().single();

  if (error) {
    console.error('Check-in save error:', error.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  // Trigger program generation for 12-week clients
  if (client.program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      });
    } catch (err) {
      console.error('Program generation trigger failed:', err.message);
    }
  }

  return res.status(200).json({ success: true, checkin_id: checkin.id });
};
