const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalate, checkMissedCheckins } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('id, phone, program, status')
      .eq('id', client_id)
      .single();

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const escalationKeyword = needsEscalation(issues);
    if (escalationKeyword) {
      await escalate(client.phone, escalationKeyword, issues);
    }

    const { data: checkin, error } = await db
      .from('checkins')
      .upsert(
        {
          client_id,
          week_no: parseInt(week_no),
          weight: weight ? parseFloat(weight) : null,
          waist: waist ? parseFloat(waist) : null,
          compliance_score: compliance_score ? parseInt(compliance_score) : null,
          energy: energy ? parseInt(energy) : null,
          issues: issues || null,
          photos_urls: photos_urls || [],
          form_submitted_at: new Date().toISOString(),
        },
        { onConflict: 'client_id,week_no' }
      )
      .select()
      .single();

    if (error) {
      console.error('Checkin insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
