const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, getEscalationReason, MADDY_PHONE } = require('./_lib/escalation');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');
const { logMessage } = require('./_lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client is not active' });

    let photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (photo.data && photo.name) {
          const buffer = Buffer.from(photo.data, 'base64');
          const path = `clients/${client_id}/week_${week_no}_photo_${i + 1}.jpg`;
          await db.storage.from('clients').upload(path, buffer, {
            contentType: photo.type || 'image/jpeg',
            upsert: true
          });
          photoUrls.push(path);
        }
      }
    }

    const { error: upsertError } = await db
      .from('checkins')
      .upsert({
        client_id,
        week_no: parseInt(week_no),
        form_submitted_at: new Date().toISOString(),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photoUrls.length > 0 ? photoUrls : null
      }, { onConflict: 'client_id,week_no' });

    if (upsertError) {
      console.error('Checkin upsert error:', upsertError.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      const reason = getEscalationReason(issues);
      await sendTemplate(MADDY_PHONE, 'escalation_alert', [
        client.name || maskPhone(client.phone),
        `Week ${week_no} checkin: ${reason}`,
        issues.slice(0, 200)
      ]);
      await logMessage(MADDY_PHONE, 'out', `ESCALATION: ${reason}`, 'escalation_alert');
    }

    if (client.program === '12wk') {
      const generateUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`;
      try {
        await fetch(generateUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (genErr) {
        console.error('Program gen trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
