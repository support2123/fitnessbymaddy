const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    client_id, week_no, weight, waist, compliance_score,
    energy, issues, photos
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .eq('status', 'active')
    .single();

  if (!client) return res.status(404).json({ error: 'Active client not found' });

  let photoUrls = [];
  if (photos && photos.length > 0) {
    for (let i = 0; i < photos.length && i < 3; i++) {
      const photo = photos[i];
      const filePath = `clients/${client_id}/checkin_w${week_no}_${i + 1}.jpg`;
      const buffer = Buffer.from(photo.data, 'base64');
      await db.storage.from('programs').upload(filePath, buffer, {
        contentType: photo.type || 'image/jpeg',
        upsert: true
      });
      const { data: urlData } = db.storage.from('programs').getPublicUrl(filePath);
      photoUrls.push(urlData.publicUrl);
    }
  }

  const { error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    form_submitted_at: new Date().toISOString(),
    weight: parseFloat(weight) || null,
    waist: parseFloat(waist) || null,
    compliance_score: parseInt(compliance_score) || null,
    energy: parseInt(energy) || null,
    issues: issues || '',
    photos_urls: photoUrls,
    next_week_focus: ''
  });

  if (error) {
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (client.program === '12wk') {
    const generateUrl = `${process.env.VERCEL_URL || 'https://fitnessbymaddy.com'}/api/generate-program`;
    await fetch(generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
      },
      body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
    });
  }

  await sendWhatsApp(client.phone, 'checkin_received', {
    name: client.name,
    templateParams: [client.name, week_no.toString()]
  });

  return res.status(200).json({ success: true, message: 'Check-in saved' });
};
