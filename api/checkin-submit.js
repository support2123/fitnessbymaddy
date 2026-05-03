const { getSupabase } = require('./_lib/supabase');
const { escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('id, phone, name, program')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    if (existingCheckin) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const { error: insertErr } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    });

    if (insertErr) {
      console.error('Check-in insert error:', insertErr);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && issues.length > 10) {
      const { needsEscalation } = require('./_lib/escalation');
      if (needsEscalation(issues)) {
        await escalateToMaddy(
          'Client check-in flagged',
          `Client: ${client.name} (${maskPhone(client.phone)})\nWeek ${week_no}\nIssues: ${issues.slice(0, 300)}`
        );
      }
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e);
      }
    }

    return res.json({ success: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Check-in error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
