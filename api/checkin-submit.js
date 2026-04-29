const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, token,
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client || client.status !== 'active') {
    return res.status(404).json({ error: 'Active client not found' });
  }

  let photoUrls = [];
  if (req.body.photos && Array.isArray(req.body.photos)) {
    for (let i = 0; i < req.body.photos.length && i < 3; i++) {
      const photo = req.body.photos[i];
      if (!photo) continue;
      const filePath = `clients/${client_id}/checkin_w${week_no}_${i + 1}.jpg`;
      const buffer = Buffer.from(photo.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      await db.storage.from('client-files').upload(filePath, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      const { data: urlData } = db.storage.from('client-files').getPublicUrl(filePath);
      photoUrls.push(urlData.publicUrl);
    }
  }

  const { error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    form_submitted_at: new Date().toISOString(),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photoUrls,
    next_week_focus: null,
  });

  if (error) {
    console.error('Checkin insert error:', error);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (issues && needsEscalation(issues)) {
    await escalateToMaddy(
      'Concerning check-in report',
      client.phone,
      `Week ${week_no}: ${issues.slice(0, 200)}`
    );
  }

  if (client.program === '12wk') {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://www.fitnessbymaddy.com';

    fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
      },
      body: JSON.stringify({
        client_id: client.id,
        week_no: parseInt(week_no) + 1,
      }),
    }).catch(err => console.error('Program generation trigger failed:', err));
  }

  await sendWhatsApp(client.phone, 'checkin_received', [
    client.name || 'there',
    String(week_no),
  ]);

  return res.status(200).json({ ok: true });
};
