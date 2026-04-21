const { supabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

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
    } = req.body;

    if (!client_id || week_no === undefined) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    // Handle photo uploads via multipart or base64 URLs
    let photosUrls = [];
    if (req.body.photos_urls && Array.isArray(req.body.photos_urls)) {
      photosUrls = req.body.photos_urls;
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy(
        client.phone,
        'Health concern in weekly check-in',
        issues
      );
    }

    const { data: checkin, error: insertErr } = await supabase
      .from('checkins')
      .upsert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photosUrls,
        form_submitted_at: new Date().toISOString(),
      }, { onConflict: 'client_id,week_no' })
      .select()
      .single();

    if (insertErr) {
      console.error('Checkin insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      const generateUrl = `${getBaseUrl(req)}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      }).catch((err) => console.error('Program generation trigger failed:', err.message));
    }

    return res.status(200).json({
      success: true,
      message: 'Check-in submitted successfully',
      checkin_id: checkin.id,
    });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
