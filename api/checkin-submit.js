const { supabase } = require('./_lib/supabase');
const { checkAndEscalate } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/pii');

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async function handler(req, res) {
  corsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
    } = req.body || {};

    // Validate required fields
    if (!client_id) {
      return res.status(400).json({ error: 'Missing required field: client_id' });
    }
    if (week_no === undefined || week_no === null) {
      return res.status(400).json({ error: 'Missing required field: week_no' });
    }

    // Verify client exists
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, phone')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Upload photos to Supabase Storage
    const photosUrls = [];
    if (photos && Array.isArray(photos) && photos.length > 0) {
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const filePath = `${client_id}/week_${week_no}/photo_${i + 1}.jpg`;

        let fileData;
        let contentType = 'image/jpeg';

        if (photo.startsWith('http://') || photo.startsWith('https://')) {
          // URL — store the URL directly
          photosUrls.push(photo);
          continue;
        }

        // Base64 data
        const base64Match = photo.match(/^data:([^;]+);base64,(.+)$/);
        if (base64Match) {
          contentType = base64Match[1];
          fileData = Buffer.from(base64Match[2], 'base64');
        } else {
          // Raw base64 without prefix
          fileData = Buffer.from(photo, 'base64');
        }

        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('checkin-photos')
          .upload(filePath, fileData, {
            contentType,
            upsert: true,
          });

        if (uploadErr) {
          console.error(`[checkin] Photo upload failed for ${maskPhone(client.phone)}:`, uploadErr.message);
          continue;
        }

        const { data: urlData } = supabase.storage
          .from('checkin-photos')
          .getPublicUrl(filePath);

        if (urlData && urlData.publicUrl) {
          photosUrls.push(urlData.publicUrl);
        }
      }
    }

    // Insert check-in record
    const { error: insertErr } = await supabase.from('checkins').insert({
      client_id,
      week_no,
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score || null,
      energy: energy || null,
      issues: issues || null,
      photos_urls: photosUrls,
    });

    if (insertErr) {
      console.error(`[checkin] Insert failed for ${maskPhone(client.phone)}:`, insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    console.log(`[checkin] Week ${week_no} submitted for client ${maskPhone(client.phone)}`);

    // Check issues text for escalation
    if (issues) {
      await checkAndEscalate(client.phone, issues, { source: 'checkin', week_no });
    }

    // Check for 2 consecutive weeks of low compliance (score <= 3)
    if (compliance_score != null && compliance_score <= 3) {
      const prevWeek = week_no - 1;
      if (prevWeek >= 1) {
        const { data: prevCheckin } = await supabase
          .from('checkins')
          .select('compliance_score')
          .eq('client_id', client_id)
          .eq('week_no', prevWeek)
          .single();

        if (prevCheckin && prevCheckin.compliance_score != null && prevCheckin.compliance_score <= 3) {
          await checkAndEscalate(
            client.phone,
            `Low compliance 2 consecutive weeks (week ${prevWeek}: ${prevCheckin.compliance_score}, week ${week_no}: ${compliance_score})`,
            { source: 'checkin_compliance', client_id }
          );
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Check-in submitted successfully!',
      photos_uploaded: photosUrls.length,
    });
  } catch (err) {
    console.error('[checkin] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
