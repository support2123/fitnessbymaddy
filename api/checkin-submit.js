import { getSupabase } from './_lib/supabase.js';
import { sendSessionMessage, maskPhone } from './_lib/whatsapp.js';
import { needsEscalation, handleEscalation } from './_lib/escalation.js';

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  const db = getSupabase();

  try {
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    let photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (!photo.data || !photo.name) continue;

        const buffer = Buffer.from(photo.data, 'base64');
        const path = `${client_id}/week_${week_no}/${photo.name}`;

        const { error: uploadErr } = await db.storage
          .from('clients')
          .upload(path, buffer, {
            contentType: photo.contentType || 'image/jpeg',
            upsert: true
          });

        if (!uploadErr) {
          const { data: urlData } = db.storage.from('clients').getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }

    const { error: insertErr } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photoUrls
    });

    if (insertErr) throw insertErr;

    if (issues) {
      const escalationReason = needsEscalation(issues);
      if (escalationReason) {
        await handleEscalation(client.phone, issues, `checkin_${escalationReason}`);
      }
    }

    const { count: missedCount } = await db
      .from('checkins')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client_id);

    const expectedWeek = parseInt(week_no, 10);
    const totalCheckins = missedCount || 0;
    if (expectedWeek - totalCheckins >= 2) {
      await handleEscalation(
        client.phone,
        `Client has missed 2+ check-ins (week ${week_no}, total submitted: ${totalCheckins})`,
        '2_consecutive_missed_checkins'
      );
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    const msg = client.name
      ? `Thanks ${client.name}! Week ${week_no} check-in received. Keep pushing!`
      : `Week ${week_no} check-in received. Keep pushing!`;
    await sendSessionMessage(client.phone, msg);

    return res.status(200).json({ ok: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
