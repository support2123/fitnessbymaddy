const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/market');

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

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    let photosUrls = [];
    if (photos && Array.isArray(photos)) {
      for (const photo of photos) {
        if (photo.base64 && photo.filename) {
          const buffer = Buffer.from(photo.base64, 'base64');
          const path = `clients/${client_id}/checkin_w${week_no}_${photo.filename}`;
          await db.storage.from('client-files').upload(path, buffer, {
            contentType: photo.type || 'image/jpeg',
            upsert: true
          });
          const { data: urlData } = db.storage.from('client-files').getPublicUrl(path);
          photosUrls.push(urlData.publicUrl);
        }
      }
    }

    if (needsEscalation(issues)) {
      await escalateToMaddy(
        'Client check-in concern',
        `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nIssues: ${issues}`
      );
    }

    const { data: checkin } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photosUrls
    }).select().single();

    if (client.program === '12wk') {
      try {
        await fetch(`${getBaseUrl(req)}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, checkinId: checkin.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
