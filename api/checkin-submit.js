const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, token,
    } = req.body || {};

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy(
        'Health concern in check-in',
        client.phone,
        `Week ${week_no}: ${issues.slice(0, 300)}`
      );
    }

    let photoUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (let i = 0; i < req.body.photos.length && i < 3; i++) {
        const photo = req.body.photos[i];
        if (photo && photo.startsWith('data:')) {
          const matches = photo.match(/^data:(.+);base64,(.+)$/);
          if (matches) {
            const ext = matches[1].includes('png') ? 'png' : 'jpg';
            const buffer = Buffer.from(matches[2], 'base64');
            const path = `clients/${client_id}/week_${week_no}_photo_${i + 1}.${ext}`;
            await db.storage.from('programs').upload(path, buffer, {
              contentType: matches[1],
              upsert: true,
            });
            const { data: urlData } = db.storage.from('programs').getPublicUrl(path);
            if (urlData?.publicUrl) photoUrls.push(urlData.publicUrl);
          }
        }
      }
    }

    const { data: checkin } = await db.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no, 10),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photoUrls,
      next_week_focus: null,
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
        });
      } catch (e) {
        console.error(`Auto-generate next week failed: ${e.message}`);
      }
    }

    return res.status(200).json({ success: true, checkinId: checkin?.id });
  } catch (err) {
    console.error(`Check-in error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};
