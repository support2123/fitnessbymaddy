const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const supabase = getSupabase();

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .eq('status', 'active')
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Active client not found' });
  }

  if (issues && needsEscalation(issues)) {
    await escalateToMaddy('Health concern in check-in', {
      phone: client.phone,
      name: client.name,
      message: issues
    });
  }

  let photoUrls = [];
  if (photos && Array.isArray(photos)) {
    for (let i = 0; i < photos.length && i < 5; i++) {
      const photo = photos[i];
      if (!photo.data || !photo.name) continue;

      const buffer = Buffer.from(photo.data, 'base64');
      const ext = photo.name.split('.').pop() || 'jpg';
      const path = `clients/${client_id}/checkin_w${week_no}_${i + 1}.${ext}`;

      await supabase.storage.from('programs').upload(path, buffer, {
        contentType: photo.type || 'image/jpeg',
        upsert: true
      });

      const { data: urlData } = supabase.storage.from('programs').getPublicUrl(path);
      if (urlData?.publicUrl) photoUrls.push(urlData.publicUrl);
    }
  }

  const { error } = await supabase.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    form_submitted_at: new Date().toISOString(),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photoUrls
  });

  if (error) {
    console.error(`Check-in save failed for client ${client_id}:`, error.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  await sendWhatsApp(client.phone, 'checkin_received', {
    name: client.name || 'there',
    templateParams: [client.name || 'there', String(week_no)]
  });
  await logMessage(client.phone, 'out', `Check-in W${week_no} received`, 'checkin_received');

  if (client.program === '12wk') {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://www.fitnessbymaddy.com';

    await fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
      },
      body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
    });
  }

  console.log(`Check-in W${week_no} for ${maskPhone(client.phone)}`);
  return res.status(200).json({ success: true });
};
