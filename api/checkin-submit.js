const { supabase } = require('./lib/supabase');

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

    // Verify client exists and is active
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) return res.status(404).json({ error: 'Active client not found' });

    // Upload photos if provided
    let photosUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length; i++) {
        const photoData = photos[i];
        if (photoData.startsWith('data:')) {
          const base64 = photoData.split(',')[1];
          const buffer = Buffer.from(base64, 'base64');
          const path = `clients/${client_id}/week_${week_no}_photo_${i + 1}.jpg`;
          await supabase.storage.from('client-data').upload(path, buffer, {
            contentType: 'image/jpeg',
            upsert: true
          });
          const { data: urlData } = supabase.storage.from('client-data').getPublicUrl(path);
          photosUrls.push(urlData.publicUrl);
        }
      }
    }

    // Insert check-in
    const { data: checkin, error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photosUrls.length > 0 ? photosUrls : null
    }).select().single();

    if (error) throw error;

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      const generateUrl = `${getBaseUrl(req)}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });

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
