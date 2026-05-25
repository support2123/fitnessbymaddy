const { getSupabase } = require('../lib/supabase');

/**
 * Masks a phone number for safe logging.
 */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, -4).replace(/.(?=.{4})/g, '*').slice(0, -4) + phone.slice(-4);
}

/**
 * Parses multipart form body fields from req.body (Vercel parses automatically
 * when Content-Type is application/json; for multipart we read raw fields).
 * Photos come as base64 strings or Buffer depending on client upload method.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = getSupabase();
    const data = req.body || {};

    const clientId = data.client_id;
    const weekNo = parseInt(data.week_no, 10);

    if (!clientId || !weekNo) {
      return res
        .status(400)
        .json({ error: 'Missing required fields: client_id, week_no' });
    }

    /* ── Validate client exists and is active ── */
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, phone, program_type, status')
      .eq('id', clientId)
      .maybeSingle();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(400).json({ error: 'Client is not active' });
    }

    /* ── Upload photos to Supabase Storage ── */
    const photoUrls = [];
    const photos = Array.isArray(data.photos) ? data.photos : [];

    for (let i = 0; i < photos.length; i++) {
      const photoData = photos[i];
      // Expect base64 encoded image data
      const buffer = Buffer.from(photoData, 'base64');
      const filePath = `clients/${clientId}/checkin_w${weekNo}_photo_${i + 1}.jpg`;

      const { error: uploadErr } = await supabase.storage
        .from('uploads')
        .upload(filePath, buffer, {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (uploadErr) {
        console.error(`Photo upload error [${filePath}]:`, uploadErr.message);
      } else {
        photoUrls.push(filePath);
      }
    }

    /* ── Insert check-in record ── */
    const { error: insertErr } = await supabase.from('checkins').insert({
      client_id: clientId,
      week_no: weekNo,
      weight: parseFloat(data.weight) || null,
      waist: parseFloat(data.waist) || null,
      compliance_score: parseInt(data.compliance_score, 10) || null,
      energy: data.energy || null,
      issues: data.issues || null,
      photo_urls: photoUrls,
      created_at: new Date().toISOString(),
    });

    if (insertErr) {
      console.error(
        `checkin-submit insert error [client:${clientId}]:`,
        insertErr.message
      );
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    /* ── If 12wk program, trigger program generation ── */
    if (client.program_type === '12wk') {
      const baseUrl =
        process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000';

      try {
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-secret': process.env.API_SECRET || '',
          },
          body: JSON.stringify({
            client_id: clientId,
            week_no: weekNo + 1,
          }),
        });
      } catch (genErr) {
        // Log but don't fail the check-in submission
        console.error(
          `checkin-submit: program generation trigger failed [client:${clientId}]:`,
          genErr.message
        );
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
