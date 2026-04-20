const { supabase } = require('./lib/supabase');
const { needsEscalation, escalate } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls,
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  let photoUrls = photos_urls || [];
  if (req.body.photos && Array.isArray(req.body.photos)) {
    for (const photo of req.body.photos) {
      if (photo.base64 && photo.filename) {
        const buffer = Buffer.from(photo.base64, 'base64');
        const path = `${client_id}/checkin_w${week_no}_${photo.filename}`;
        const { data: uploaded } = await supabase.storage
          .from('clients')
          .upload(path, buffer, { contentType: photo.type || 'image/jpeg', upsert: true });
        if (uploaded) {
          const { data: urlData } = supabase.storage.from('clients').getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }
  }

  const { data: checkin, error } = await supabase.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no, 10),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
    energy: energy ? parseInt(energy, 10) : null,
    issues: issues || null,
    photos_urls: photoUrls,
  }).select().single();

  if (error) {
    console.error('Checkin insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (issues && needsEscalation(issues)) {
    await escalate(
      client.phone,
      'Health concern in weekly check-in',
      `Week ${week_no}: ${issues.slice(0, 200)}`
    );
  }

  if (client.program === '12wk') {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://fitnessbymaddy.com';

    try {
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
      });
    } catch (err) {
      console.error('Program generation trigger failed:', err.message);
    }
  }

  return res.status(200).json({ status: 'saved', checkin_id: checkin.id });
};
