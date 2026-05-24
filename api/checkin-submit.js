const { supabase } = require('../lib/supabase');
const { checkEscalation, createEscalation, checkMissedCheckins } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id, phone, program')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (issues) {
      const escalation = checkEscalation(issues);
      if (escalation) {
        await createEscalation({
          phone: client.phone,
          clientId: client.id,
          reason: `Health concern in check-in: "${escalation}"`,
          triggerMessage: issues
        });
      }
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .limit(1)
      .single();

    if (existing) {
      const { error } = await supabase
        .from('checkins')
        .update({
          weight, waist, compliance_score, energy, issues,
          photos_urls: photos_urls || [],
          form_submitted_at: new Date().toISOString()
        })
        .eq('id', existing.id);

      if (error) {
        console.error('Check-in update error:', error.message);
        return res.status(500).json({ error: 'Failed to update check-in' });
      }
    } else {
      const { error } = await supabase
        .from('checkins')
        .insert({
          client_id, week_no, weight, waist,
          compliance_score, energy, issues,
          photos_urls: photos_urls || []
        });

      if (error) {
        console.error('Check-in insert error:', error.message);
        return res.status(500).json({ error: 'Failed to save check-in' });
      }
    }

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
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Check-in submit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
