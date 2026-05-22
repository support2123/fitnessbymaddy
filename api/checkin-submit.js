const { getSupabase } = require('./lib/supabase');
const { checkEscalation, createEscalation } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

  try {
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const { data: checkin } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      photos_urls: photos_urls || []
    }).select().single();

    if (issues) {
      const escalationTrigger = checkEscalation(issues);
      if (escalationTrigger) {
        await createEscalation({
          sourceType: 'checkin',
          sourceId: checkin.id,
          phone: client.phone,
          reason: `Check-in flag: ${escalationTrigger}`,
          messageBody: issues
        });
      }
    }

    if (client.program === '12wk') {
      try {
        const generateUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`;
        await fetch(generateUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({
            client_id,
            week_no: parseInt(week_no) + 1
          })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, checkinId: checkin.id });

  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
