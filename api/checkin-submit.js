const supabase = require('./_lib/supabase');
const { checkAndEscalate } = require('./_lib/escalation');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://fitnessbymaddy.com',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    for (const [key, val] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, val);
    }
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  for (const [key, val] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, val);
  }

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

    if (!client_id) {
      return res.status(400).json({ error: 'Missing required field: client_id' });
    }

    // Validate client exists and is active
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, phone, program')
      .eq('id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    // Insert check-in record
    const { data: checkin, error: checkinErr } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: week_no || 1,
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score || null,
        energy: energy || null,
        issues: issues || null,
        photos_urls: photos_urls || [],
      })
      .select('id')
      .single();

    if (checkinErr) {
      console.error('Failed to insert check-in:', checkinErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Check escalation on issues text
    if (issues && issues.trim()) {
      await checkAndEscalate(client.phone, issues, 'checkin', checkin.id);
    }

    // Check for 2 consecutive missed check-ins
    const currentWeek = week_no || 1;
    if (currentWeek > 2) {
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client_id)
        .in('week_no', [currentWeek - 1, currentWeek - 2]);

      const submittedWeeks = (recentCheckins || []).map((c) => c.week_no);
      const missedPrev1 = !submittedWeeks.includes(currentWeek - 1);
      const missedPrev2 = !submittedWeeks.includes(currentWeek - 2);

      if (missedPrev1 && missedPrev2) {
        await checkAndEscalate(
          client.phone,
          `Client missed 2 consecutive check-ins (weeks ${currentWeek - 2} and ${currentWeek - 1})`,
          'checkin_missed',
          checkin.id
        );
      }
    }

    // If 12wk program, trigger program generation
    if (client.program === '12wk') {
      try {
        const host =
          req.headers['x-forwarded-host'] ||
          req.headers.host ||
          'fitnessbymaddy.com';
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const generateUrl = `${protocol}://${host}/api/generate-program`;

        const genRes = await fetch(generateUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: currentWeek }),
        });

        if (!genRes.ok) {
          console.error('Program generation failed:', await genRes.text());
        }
      } catch (genErr) {
        console.error('Program generation request failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('checkin-submit error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
