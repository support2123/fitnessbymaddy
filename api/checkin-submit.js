const { getSupabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/escalation');
const { notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

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
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

    // Upload photos to Supabase Storage
    const photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 3; i++) {
        const photo = photos[i];
        if (!photo.data || !photo.name) continue;

        const buffer = Buffer.from(photo.data, 'base64');
        const ext = photo.name.split('.').pop() || 'jpg';
        const path = `clients/${client_id}/checkin_w${week_no}_${i + 1}.${ext}`;

        const { data: upload } = await db.storage
          .from('client-files')
          .upload(path, buffer, {
            contentType: photo.type || 'image/jpeg',
            upsert: true,
          });

        if (upload) {
          const { data: urlData } = db.storage.from('client-files').getPublicUrl(path);
          if (urlData) photoUrls.push(urlData.publicUrl);
        }
      }
    }

    const { data: checkin } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photoUrls,
    }).select().single();

    // Escalation check on issues
    if (needsEscalation(issues)) {
      await notifyMaddy(
        'Check-in health concern',
        `Client: ${maskPhone(client.phone)} (${client.name})\nWeek ${week_no}\nIssues: ${issues.slice(0, 200)}`
      );
    }

    // Check for consecutive missed check-ins (current week means they submitted, check history)
    const weekNum = parseInt(week_no, 10);
    if (weekNum >= 3) {
      const { data: recent } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client_id)
        .gte('week_no', weekNum - 2)
        .lt('week_no', weekNum)
        .order('week_no', { ascending: false });

      if (!recent || recent.length === 0) {
        await notifyMaddy(
          '2 consecutive missed check-ins before this one',
          `Client: ${maskPhone(client.phone)} (${client.name})\nWeeks ${weekNum - 2} and ${weekNum - 1} were missed`
        );
      }
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: weekNum + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });

  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
