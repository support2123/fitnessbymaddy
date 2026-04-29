const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/phone');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos
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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(403).json({ error: 'Client is not active' });
    }

    if (needsEscalation(issues)) {
      await escalateToMaddy('Health concern in check-in', {
        phone: maskPhone(client.phone),
        message: `Week ${week_no}: ${issues}`
      });
    }

    let photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photoData = photos[i];
        if (typeof photoData === 'string' && photoData.startsWith('data:')) {
          const base64 = photoData.split(',')[1];
          const buffer = Buffer.from(base64, 'base64');
          const path = `clients/${client_id}/week_${week_no}_photo_${i + 1}.jpg`;

          const { data: uploaded } = await db.storage
            .from('checkin-photos')
            .upload(path, buffer, {
              contentType: 'image/jpeg',
              upsert: true
            });

          if (uploaded) {
            const { data: urlData } = db.storage
              .from('checkin-photos')
              .getPublicUrl(path);
            photoUrls.push(urlData.publicUrl);
          }
        } else if (typeof photoData === 'string') {
          photoUrls.push(photoData);
        }
      }
    }

    const { error } = await db.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls,
      form_submitted_at: new Date().toISOString()
    }, {
      onConflict: 'client_id,week_no'
    });

    if (error) {
      console.error('Checkin insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger error:', e.message);
      }
    }

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(3);

    if (missedCheckins) {
      const weekNos = missedCheckins.map(c => c.week_no);
      const currentWeek = parseInt(week_no);
      const expectedWeeks = [currentWeek - 1, currentWeek - 2];
      const missed = expectedWeeks.filter(w => w > 0 && !weekNos.includes(w));

      if (missed.length >= 2) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: maskPhone(client.phone),
          message: `Client ${client.name} missed weeks ${missed.join(', ')}`
        });
      }
    }

    return res.status(200).json({ ok: true, message: 'Check-in submitted' });

  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
