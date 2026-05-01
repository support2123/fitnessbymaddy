const { getSupabase } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');
const { needsEscalation, createEscalation, checkMissedCheckins } = require('../lib/escalation');
const { isHinglish } = require('../lib/market');
const { detectMarket } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const { data: client, error: clientErr } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const photosUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (photo.startsWith('data:')) {
          const matches = photo.match(/^data:(.+);base64,(.+)$/);
          if (matches) {
            const ext = matches[1].includes('png') ? 'png' : 'jpg';
            const buffer = Buffer.from(matches[2], 'base64');
            const path = `${client_id}/week_${week_no}_photo_${i + 1}.${ext}`;

            const { error: uploadErr } = await db.storage
              .from('clients')
              .upload(path, buffer, { contentType: matches[1], upsert: true });

            if (!uploadErr) {
              photosUrls.push(path);
            }
          }
        } else {
          photosUrls.push(photo);
        }
      }
    }

    const { error: checkinErr } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photosUrls,
    });

    if (checkinErr) {
      console.error('Checkin insert error:', checkinErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues) {
      const escalationKeyword = needsEscalation(issues);
      if (escalationKeyword) {
        await createEscalation(client.phone, client_id, escalationKeyword, issues);
      }
    }

    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);

    const confirmMsg = hinglish
      ? `Check-in week ${week_no} mil gaya! 💪 Maddy review karke next week ka plan bhejegi.`
      : `Week ${week_no} check-in received! 💪 Maddy will review and send your next week's plan.`;

    await sendText(client.phone, confirmMsg);

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger error:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, week_no });
  } catch (err) {
    console.error('Checkin submit error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
