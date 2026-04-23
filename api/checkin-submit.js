import supabase from './lib/supabase.js';
import { needsEscalation, maskPhone } from './lib/utils.js';
import { sendToMaddy } from './lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) return res.status(404).json({ error: 'Client not found' });

    // Upload photos to Supabase Storage
    const photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (!photo.data) continue;
        const buffer = Buffer.from(photo.data, 'base64');
        const ext = photo.type?.split('/')[1] || 'jpg';
        const path = `clients/${client_id}/week_${week_no}/photo_${i + 1}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from('checkin-photos')
          .upload(path, buffer, {
            contentType: photo.type || 'image/jpeg',
            upsert: true,
          });

        if (!uploadErr) {
          const { data: urlData } = supabase.storage
            .from('checkin-photos')
            .getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }

    // Save check-in
    const { error: checkinErr } = await supabase.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls,
    }, { onConflict: 'client_id,week_no' });

    if (checkinErr) {
      console.error('Checkin save error:', checkinErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Escalation check on issues text
    if (issues && needsEscalation(issues)) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        client_id: client.id,
        trigger: 'checkin_keyword',
        message: issues,
      });
      await sendToMaddy(
        `🚨 CHECK-IN ALERT\nClient: ${client.name || maskPhone(client.phone)}\nWeek ${week_no}\nIssue: "${issues.slice(0, 200)}"`
      );
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      const origin = `https://${req.headers.host}`;
      fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, message: 'Check-in submitted successfully' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
