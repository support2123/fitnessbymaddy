const { supabase } = require('../lib/supabase');
const { needsEscalation, maskPhone } = require('../lib/helpers');
const { createEscalation, checkConsecutiveMissedCheckins } = require('../lib/escalation');

const MAX_PHOTOS = 3;

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      c: clientId,
      w: weekNo,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos,
    } = req.body;

    if (!clientId || !weekNo) {
      return res.status(400).json({ error: 'Missing required fields: c (client_id), w (week_no)' });
    }

    // Validate client exists and is active
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, phone, program, status')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(403).json({ error: 'Client is not active' });
    }

    console.log(`[Checkin] Client ${clientId} submitting week ${weekNo}`);

    // Upload photos to Supabase Storage
    const photoUrls = [];
    if (photos && Array.isArray(photos)) {
      const photosToUpload = photos.slice(0, MAX_PHOTOS);

      for (let i = 0; i < photosToUpload.length; i++) {
        const photo = photosToUpload[i];
        const storagePath = `${clientId}/week_${weekNo}/photo_${i + 1}.jpg`;

        try {
          if (photo.startsWith('http')) {
            // Photo is a URL — store the URL directly
            photoUrls.push(photo);
          } else {
            // Photo is base64 — upload to storage
            const buffer = Buffer.from(photo, 'base64');
            const { error: uploadError } = await supabase.storage
              .from('checkin-photos')
              .upload(storagePath, buffer, {
                contentType: 'image/jpeg',
                upsert: true,
              });

            if (uploadError) {
              console.error(`[Checkin] Photo upload failed (${i + 1}):`, uploadError.message);
              continue;
            }

            const { data: urlData } = supabase.storage
              .from('checkin-photos')
              .getPublicUrl(storagePath);

            photoUrls.push(urlData.publicUrl);
          }
        } catch (photoErr) {
          console.error(`[Checkin] Photo processing error (${i + 1}):`, photoErr.message);
        }
      }
    }

    // Insert check-in record
    const { data: checkin, error: insertError } = await supabase
      .from('checkins')
      .insert({
        client_id: clientId,
        week_no: parseInt(weekNo, 10),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
        energy: energy || null,
        issues: issues || null,
        photo_urls: photoUrls.length > 0 ? photoUrls : null,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Checkin] Insert failed:', insertError.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    console.log(`[Checkin] Saved: client ${clientId}, week ${weekNo}, ${photoUrls.length} photos`);

    // Check for escalation keywords in issues
    if (issues && needsEscalation(issues)) {
      console.log(`[Checkin] Escalation triggered for ${maskPhone(client.phone)}: "${issues.slice(0, 100)}"`);
      await createEscalation({
        phone: client.phone,
        clientId,
        reason: 'Escalation keyword in check-in issues',
        messageBody: issues,
      });
    }

    // For 12-week program, note that program generation may be needed
    if (client.program === '12wk') {
      console.log(`[Checkin] 12wk client ${clientId} week ${weekNo} — would trigger program adjustment via /api/generate-program`);
      // TODO: POST to /api/generate-program with { client_id: clientId, week_no: weekNo }
    }

    // Check for consecutive missed check-ins
    await checkConsecutiveMissedCheckins(clientId);

    return res.status(200).json({
      ok: true,
      checkin_id: checkin.id,
      week_no: checkin.week_no,
      photos_uploaded: photoUrls.length,
    });
  } catch (err) {
    console.error('[Checkin] Submit error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
