const { getSupabase } = require('./_lib/supabase');
const { corsHeaders } = require('./_lib/helpers');
const { checkConsecutiveMissed } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body || {};
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos_urls,
    } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'missing client_id or week_no' });
    }

    const supabase = getSupabase();

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client not found' });
    if (client.status !== 'active') {
      return res.status(400).json({ error: 'client not active' });
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .limit(1)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'check-in already submitted for this week' });
    }

    const { data: checkin, error } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[CHECKIN ERROR]', error.message);
      return res.status(500).json({ error: 'insert_failed' });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (err) {
        console.error('[CHECKIN] Program generation trigger failed:', err.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Check-in received! Your next program update is being prepared.',
      checkin_id: checkin.id,
    });
  } catch (err) {
    console.error('[CHECKIN ERROR]', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};
