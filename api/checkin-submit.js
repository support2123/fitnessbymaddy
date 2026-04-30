const { getSupabase } = require('../lib/supabase');
const { needsEscalation, createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, next_week_focus,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('id, phone, program, name')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    let photoUrls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (let i = 0; i < Math.min(req.body.photos.length, 3); i++) {
        const photo = req.body.photos[i];
        if (photo && photo.startsWith('data:image')) {
          const base64Data = photo.split(',')[1];
          const buffer = Buffer.from(base64Data, 'base64');
          const ext = photo.includes('png') ? 'png' : 'jpg';
          const path = `${client_id}/checkin_w${week_no}_${i + 1}.${ext}`;

          await db.storage.from('clients').upload(path, buffer, {
            contentType: `image/${ext}`,
            upsert: true,
          });

          const { data: urlData } = db.storage.from('clients').getPublicUrl(path);
          photoUrls.push(urlData?.publicUrl || path);
        }
      }
    }

    const { data: checkin } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues?.substring(0, 2000),
      photos_urls: photoUrls,
      next_week_focus: next_week_focus?.substring(0, 500),
    }).select('id').single();

    const escalationKeyword = needsEscalation(issues);
    if (escalationKeyword) {
      await createEscalation(client.phone, `checkin_w${week_no}: ${escalationKeyword}`, issues);
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin?.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
