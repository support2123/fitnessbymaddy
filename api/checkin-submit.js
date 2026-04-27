const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no,
      weight, waist,
      compliance_score, energy,
      issues, next_week_focus,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy(
        'Health concern in check-in',
        client.phone,
        issues.slice(0, 300)
      );
    }

    let photosUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (const photo of req.body.photos) {
        if (photo.url) {
          photosUrls.push(photo.url);
        } else if (photo.base64) {
          const buffer = Buffer.from(photo.base64, 'base64');
          const filename = `clients/${client_id}/checkin_w${week_no}_${Date.now()}.jpg`;
          await db.storage.from('client-files').upload(filename, buffer, {
            contentType: 'image/jpeg',
            upsert: true,
          });
          const { data: urlData } = db.storage.from('client-files').getPublicUrl(filename);
          photosUrls.push(urlData.publicUrl);
        }
      }
    }

    const { data: checkin } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      photos_urls: photosUrls,
      next_week_focus: next_week_focus || null,
      form_submitted_at: new Date().toISOString(),
    }).select().single();

    if (client.program === '12wk') {
      const baseUrl = process.env.VERCEL_URL || 'fitnessbymaddy.com';
      fetch(`https://${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({
          client_id: client.id,
          week_no: parseInt(week_no) + 1,
        }),
      }).catch(err => console.error('[checkin-submit] program gen error:', err.message));
    }

    return res.json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('[checkin-submit]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
