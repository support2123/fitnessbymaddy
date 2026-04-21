const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos,
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
  if (photos && Array.isArray(photos)) {
    for (let i = 0; i < photos.length && i < 3; i++) {
      const raw = photos[i].replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(raw, 'base64');
      const path = `${client_id}/checkins/week_${week_no}_photo_${i + 1}.jpg`;
      await db.storage.from('clients').upload(path, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      const { data: urlData } = db.storage.from('clients').getPublicUrl(path);
      photoUrls.push(urlData.publicUrl);
    }
  }

  if (issues && needsEscalation(issues)) {
    await escalateToMaddy({
      reason: 'Check-in reported concerning issue',
      phone: client.phone,
      message: issues,
      clientName: client.name,
    });
  }

  const { data: checkin, error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    form_submitted_at: new Date().toISOString(),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photoUrls,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const market = detectMarket(client.phone);
  const hinglish = isHinglish(market);

  const confirmBody = hinglish
    ? `Check-in received! ✅ Week ${week_no} ka data save ho gaya. Tera updated program jaldi aayega. Keep pushing! \u{1F4AA}`
    : `Check-in received! ✅ Week ${week_no} data saved. Your updated program will be ready soon. Keep pushing! \u{1F4AA}`;

  await sendWhatsApp({
    phone: client.phone,
    templateName: 'checkin_confirm',
    body: confirmBody,
  });

  if (client.program === '12wk') {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://fitnessbymaddy.com';
    fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
    }).catch(() => {});
  }

  res.json({ ok: true, checkinId: checkin?.id });
};
