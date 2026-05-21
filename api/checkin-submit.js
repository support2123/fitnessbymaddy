const { getClient } = require('./_lib/supabase');
const { notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone, needsEscalation, jsonResponse } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  /* ── CORS preflight ── */
  if (req.method === 'OPTIONS') {
    return jsonResponse(res, 200, { ok: true });
  }

  /* ── Only POST allowed ── */
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  let clientPhone;

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
    } = req.body || {};

    const db = getClient();

    /* ── 1. Validate client exists and is active ── */
    const { data: client, error: clientErr } = await db
      .from('clients')
      .select('id, phone, name, program, status')
      .eq('id', client_id)
      .limit(1)
      .single();

    if (clientErr || !client) {
      return jsonResponse(res, 400, { error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return jsonResponse(res, 400, { error: 'Client is not active' });
    }

    clientPhone = client.phone;

    /* ── 2. Handle photo uploads ── */
    const photosUrls = [];

    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];

        if (photo && (photo.startsWith('http://') || photo.startsWith('https://'))) {
          /* Already a URL — use as-is */
          photosUrls.push(photo);
        } else if (photo && photo.length > 0) {
          /* Base64 string — upload to Supabase Storage */
          const filePath = `${client_id}/checkin_w${week_no}_${i}.jpg`;

          // Strip data URI prefix if present (e.g. "data:image/jpeg;base64,...")
          const base64Data = photo.includes(',') ? photo.split(',')[1] : photo;
          const buffer = Buffer.from(base64Data, 'base64');

          const { error: uploadErr } = await db.storage
            .from('clients')
            .upload(filePath, buffer, {
              contentType: 'image/jpeg',
              upsert: true
            });

          if (!uploadErr) {
            const { data: urlData } = db.storage
              .from('clients')
              .getPublicUrl(filePath);

            if (urlData && urlData.publicUrl) {
              photosUrls.push(urlData.publicUrl);
            }
          } else {
            console.error(`[checkin-submit] Photo upload failed for index ${i}: ${uploadErr.message}`);
          }
        }
      }
    }

    /* ── 3. Insert check-in record ── */
    await db.from('checkins').insert({
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues: issues || null,
      photos_urls: photosUrls,
      form_submitted_at: new Date().toISOString()
    });

    /* ── 4. Escalation check on issues ── */
    if (needsEscalation(issues)) {
      await notifyMaddy(
        'Check-in issue needs review',
        `Client: ${client.name || 'Unknown'}\nPhone: ${maskPhone(clientPhone)}\nWeek: ${week_no}\nIssue: ${issues}`
      );
    }

    /* ── 5. If 12wk program, trigger next week's program generation ── */
    if (client.program === '12wk') {
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;

      try {
        await fetch(`${protocol}://${host}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: week_no + 1 })
        });
      } catch (genErr) {
        console.error(`[checkin-submit] Program generation trigger failed: ${genErr.message}`);
      }
    }

    /* ── 6. Check for 2 consecutive missed check-ins ── */
    const { data: recentCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    if (recentCheckins && recentCheckins.length > 0) {
      const lastSubmittedWeek = recentCheckins[0].week_no;
      /*
       * We just inserted week_no, so lastSubmittedWeek should equal week_no.
       * The "expected" week is based on consecutive progression.
       * If the gap between the current submission and the previous one is > 2,
       * it means the client skipped 2+ weeks before this check-in.
       */
      const { data: previousCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client_id)
        .lt('week_no', week_no)
        .order('week_no', { ascending: false })
        .limit(1);

      if (previousCheckins && previousCheckins.length > 0) {
        const prevWeek = previousCheckins[0].week_no;
        const gap = week_no - prevWeek;

        if (gap > 2) {
          await notifyMaddy(
            'Missed check-ins detected',
            `Client: ${client.name || 'Unknown'}\nPhone: ${maskPhone(clientPhone)}\nLast submitted: Week ${prevWeek}\nCurrent: Week ${week_no}\nGap: ${gap - 1} missed week(s)`
          );
        }
      }
    }

    return jsonResponse(res, 200, { ok: true });
  } catch (err) {
    console.error(`[checkin-submit] Error for ${maskPhone(clientPhone || '')}: ${err.message}`);
    return jsonResponse(res, 500, { error: 'Internal server error' });
  }
};
