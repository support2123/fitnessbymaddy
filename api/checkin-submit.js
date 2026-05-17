const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const supabase = getSupabase();

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    let photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length; i++) {
        const photoData = photos[i];
        if (!photoData) continue;
        const filePath = `${client_id}/week_${week_no}_photo_${i + 1}.jpg`;
        const buffer = Buffer.from(photoData.split(',')[1] || photoData, 'base64');
        await supabase.storage
          .from('checkin-photos')
          .upload(filePath, buffer, { contentType: 'image/jpeg', upsert: true });
        const { data: urlData } = supabase.storage
          .from('checkin-photos')
          .getPublicUrl(filePath);
        photoUrls.push(urlData.publicUrl);
      }
    }

    const { data: checkin, error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls,
      form_submitted_at: new Date().toISOString(),
    }).select().single();

    if (error) throw error;

    if (client.program === '12wk') {
      await triggerProgramGeneration(client_id, parseInt(week_no));
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function triggerProgramGeneration(clientId, weekNo) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://fitnessbymaddy.com';

  await fetch(`${baseUrl}/api/generate-program`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, week_no: weekNo + 1 }),
  }).catch(() => {});
}
