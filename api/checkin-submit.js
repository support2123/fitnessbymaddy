const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photo_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    // Verify client
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    // Check for duplicate submission
    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    // Check escalation triggers in issues
    if (needsEscalation(issues)) {
      await escalateToMaddy({
        reason: 'Health concern in weekly check-in',
        phone: client.phone,
        clientName: client.name,
        message: issues
      });
    }

    // Upload photos to Supabase Storage if provided as base64
    const photosUrls = [];
    if (photo_urls && Array.isArray(photo_urls)) {
      for (let i = 0; i < photo_urls.length && i < 5; i++) {
        const url = photo_urls[i];
        if (url.startsWith('data:')) {
          const matches = url.match(/^data:image\/(\w+);base64,(.+)$/);
          if (matches) {
            const ext = matches[1];
            const buffer = Buffer.from(matches[2], 'base64');
            const path = `clients/${client_id}/checkin_w${week_no}_${i}.${ext}`;
            const { data: uploaded } = await db.storage
              .from('client-files')
              .upload(path, buffer, { contentType: `image/${ext}`, upsert: true });
            if (uploaded) {
              const { data: publicUrl } = db.storage
                .from('client-files')
                .getPublicUrl(path);
              photosUrls.push(publicUrl.publicUrl);
            }
          }
        } else {
          photosUrls.push(url);
        }
      }
    }

    // Insert check-in
    const { data: checkin, error } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photosUrls
    }).select().single();

    if (error) throw error;

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, checkinId: checkin.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
