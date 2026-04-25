const { getSupabase } = require('./lib/supabase');
const { sendEscalation } = require('./lib/whatsapp');
const { handleCors, jsonError, jsonOk, needsEscalation } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return jsonError(res, 'POST only', 405);

  const db = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos,
  } = req.body || {};

  if (!client_id || !week_no) {
    return jsonError(res, 'client_id and week_no required');
  }

  const { data: client, error } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .eq('status', 'active')
    .single();

  if (error || !client) return jsonError(res, 'Active client not found', 404);

  let photoUrls = [];
  if (photos && Array.isArray(photos)) {
    for (let i = 0; i < photos.length && i < 5; i++) {
      const photo = photos[i];
      if (photo.startsWith('data:')) {
        const matches = photo.match(/^data:(.+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1].includes('png') ? 'png' : 'jpg';
          const buffer = Buffer.from(matches[2], 'base64');
          const path = `clients/${client_id}/checkin_w${week_no}_${i}.${ext}`;
          await db.storage.from('client-files').upload(path, buffer, {
            contentType: matches[1],
            upsert: true,
          });
          const { data: urlData } = db.storage.from('client-files').getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      } else {
        photoUrls.push(photo);
      }
    }
  }

  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', week_no)
    .limit(1)
    .single();

  const checkinData = {
    client_id,
    week_no: parseInt(week_no),
    form_submitted_at: new Date().toISOString(),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photoUrls.length > 0 ? photoUrls : null,
  };

  if (existing) {
    await db.from('checkins').update(checkinData).eq('id', existing.id);
  } else {
    await db.from('checkins').insert(checkinData);
  }

  if (needsEscalation(issues)) {
    await sendEscalation(
      'Client check-in concern',
      `Client ${client.name || client_id}, Week ${week_no}: ${(issues || '').slice(0, 100)}`
    );
  }

  if (client.program === '12wk') {
    const origin = req.headers['x-forwarded-host'] || req.headers.host || 'fitnessbymaddy.com';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    try {
      await fetch(`${proto}://${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      });
    } catch (_) {}
  }

  return jsonOk(res, { submitted: true });
};
