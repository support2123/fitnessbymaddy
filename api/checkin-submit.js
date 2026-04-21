const { supabase } = require('./lib/supabase');
const { needsEscalation } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalate');
const { cors, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { client_id, week_no, token, weight, waist, compliance_score, energy, issues, photos_urls } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) return res.status(404).json({ error: 'Active client not found' });

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const photoUrls = [];
    if (photos_urls && Array.isArray(photos_urls)) {
      for (const url of photos_urls.slice(0, 3)) {
        photoUrls.push(url);
      }
    }

    const checkinData = {
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: Math.min(10, Math.max(1, parseInt(compliance_score) || 5)),
      energy: Math.min(10, Math.max(1, parseInt(energy) || 5)),
      issues: issues || '',
      photos_urls: photoUrls,
      next_week_focus: '',
    };

    const { error } = await supabase.from('checkins').insert(checkinData);
    if (error) {
      console.error('Checkin insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Health concern in weekly check-in', {
        phone: client.phone,
        name: client.name,
        program: client.program,
        message: issues,
        extra: `Week ${week_no}`,
      });
    }

    if (['12wk'].includes(client.program)) {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.SITE_URL || 'https://fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      }).catch(err => console.error('Program gen trigger failed:', err.message));
    }

    return res.status(200).json({ success: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
