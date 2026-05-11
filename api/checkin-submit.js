const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, maskPhone, notifyMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supabase = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (clientErr || !client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  if (client.status !== 'active') {
    return res.status(400).json({ error: 'Client is not active' });
  }

  let photoUrls = [];
  if (req.body.photos && Array.isArray(req.body.photos)) {
    for (const photo of req.body.photos.slice(0, 3)) {
      if (photo.data && photo.name) {
        const buffer = Buffer.from(photo.data, 'base64');
        const path = `clients/${client_id}/week_${week_no}_${photo.name}`;
        const { error: uploadErr } = await supabase.storage
          .from('clients')
          .upload(path, buffer, { contentType: photo.type || 'image/jpeg' });

        if (!uploadErr) {
          const { data: urlData } = supabase.storage
            .from('clients')
            .getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }
  }

  const { data: checkin, error: checkinErr } = await supabase
    .from('checkins')
    .upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls,
      form_submitted_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' })
    .select()
    .single();

  if (checkinErr) {
    console.error('Check-in save failed:', checkinErr.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (issues && needsEscalation(issues)) {
    await notifyMaddy(
      'Client health concern',
      `Client: ${maskPhone(client.phone)} | Week ${week_no} | Issue: ${issues.substring(0, 150)}`
    );
  }

  if (client.program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({
          client_id: client.id,
          week_no: parseInt(week_no) + 1
        })
      });
    } catch (err) {
      console.error('Program generation trigger failed:', err.message);
    }
  }

  return res.status(200).json({ success: true, checkin_id: checkin.id });
};
