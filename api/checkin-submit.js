const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { json, parseBody } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, { ok: true });
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const body = await parseBody(req);
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues
  } = body;

  if (!client_id || !week_no) {
    return json(res, { error: 'client_id and week_no required' }, 400);
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return json(res, { error: 'client not found' }, 404);

  // Handle photo uploads
  const photoUrls = [];
  if (body.photos && Array.isArray(body.photos)) {
    for (let i = 0; i < body.photos.length && i < 3; i++) {
      const photo = body.photos[i];
      if (!photo.data) continue;

      const buffer = Buffer.from(photo.data, 'base64');
      const ext = photo.type === 'image/png' ? 'png' : 'jpg';
      const path = `${client_id}/checkin_w${week_no}_${i + 1}.${ext}`;

      await db.storage.from('clients').upload(path, buffer, {
        contentType: photo.type || 'image/jpeg',
        upsert: true,
      });

      const { data: urlData } = db.storage.from('clients').getPublicUrl(path);
      if (urlData?.publicUrl) photoUrls.push(urlData.publicUrl);
    }
  }

  const { data: checkin, error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no, 10),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
    energy: energy ? parseInt(energy, 10) : null,
    issues: issues || null,
    photos_urls: photoUrls,
  }).select().single();

  if (error) return json(res, { error: error.message }, 500);

  // Check for escalation triggers
  if (issues) {
    const escalationWords = /\b(pain|dizziness|dizzy|injury|injured|nausea|faint|eating disorder|vomiting)\b/i;
    if (escalationWords.test(issues)) {
      await sendWhatsApp(process.env.MADDY_PHONE || '+917082478374', 'escalation_alert', {
        name: 'Maddy',
        templateParams: [
          client.name || 'A client',
          `Week ${week_no} check-in flagged: ${issues.substring(0, 200)}`,
          new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        ],
      });
    }
  }

  // Trigger program generation for 12-week clients
  if (client.program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
      });
    } catch (e) {
      // Program generation runs async; failure is logged by that endpoint
    }
  }

  return json(res, { ok: true, checkin_id: checkin.id });
};
