const { supabase } = require('./lib/supabase');
const { notifyMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      clientId,
      weekNo,
      weight,
      waist,
      complianceScore,
      energy,
      issues,
      photosUrls,
    } = req.body;

    if (!clientId || !weekNo) {
      return res.status(400).json({ error: 'clientId and weekNo are required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', clientId)
      .eq('week_no', weekNo)
      .single();

    if (existing) {
      await supabase
        .from('checkins')
        .update({
          weight,
          waist,
          compliance_score: complianceScore,
          energy,
          issues,
          photos_urls: photosUrls || [],
          form_submitted_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert({
        client_id: clientId,
        week_no: weekNo,
        weight,
        waist,
        compliance_score: complianceScore,
        energy,
        issues,
        photos_urls: photosUrls || [],
      });
    }

    if (issues && (
      issues.toLowerCase().includes('pain') ||
      issues.toLowerCase().includes('dizzy') ||
      issues.toLowerCase().includes('eating')
    )) {
      await notifyMaddy('Concerning check-in report', {
        name: client.name,
        phone: client.phone,
        details: `Week ${weekNo}: ${issues.slice(0, 200)}`,
      });
    }

    if (client.program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ clientId, weekNo: weekNo + 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, message: 'Check-in saved' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
