const { getClient } = require('../lib/supabase');
const { needsEscalation, escalateMessage } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    const complianceNum = parseInt(compliance_score, 10);
    const energyNum = parseInt(energy, 10);

    if (complianceNum < 1 || complianceNum > 10 || energyNum < 1 || energyNum > 10) {
      return res.status(400).json({ error: 'compliance_score and energy must be 1-10' });
    }

    const db = getClient();

    const { data: client } = await db
      .from('clients')
      .select('id, name, phone, program')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (issues && needsEscalation(issues)) {
      await escalateMessage(
        client.phone,
        issues,
        'Health concern flagged in weekly check-in'
      );
    }

    const { data: checkin, error } = await db
      .from('checkins')
      .upsert(
        {
          client_id,
          week_no: parseInt(week_no, 10),
          weight: weight ? parseFloat(weight) : null,
          waist: waist ? parseFloat(waist) : null,
          compliance_score: complianceNum,
          energy: energyNum,
          issues: issues || null,
          photos_urls: photos_urls || [],
          form_submitted_at: new Date().toISOString(),
        },
        { onConflict: 'client_id,week_no' }
      )
      .select('id')
      .single();

    if (error) {
      console.error('Checkin save error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
