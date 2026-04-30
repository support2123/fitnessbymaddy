const { getSupabase } = require('../lib/supabase');
const { sendText, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone, corsHeaders, jsonResponse, errorResponse } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return errorResponse(res, 'Method not allowed', 405);

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos
    } = req.body;

    if (!client_id || !week_no) {
      return errorResponse(res, 'client_id and week_no required');
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return errorResponse(res, 'Active client not found', 404);
    }

    let photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length && i < 5; i++) {
        const photo = photos[i];
        if (typeof photo === 'string' && photo.startsWith('data:')) {
          const matches = photo.match(/^data:image\/(\w+);base64,(.+)$/);
          if (matches) {
            const ext = matches[1];
            const buffer = Buffer.from(matches[2], 'base64');
            const path = `clients/${client_id}/checkin_w${week_no}_${i + 1}.${ext}`;

            const { data: uploaded } = await db.storage
              .from('client-files')
              .upload(path, buffer, {
                contentType: `image/${ext}`,
                upsert: true
              });

            if (uploaded) {
              const { data: urlData } = db.storage
                .from('client-files')
                .getPublicUrl(path);
              photoUrls.push(urlData.publicUrl);
            }
          }
        } else if (typeof photo === 'string') {
          photoUrls.push(photo);
        }
      }
    }

    const { data: checkin, error } = await db.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls,
      form_submitted_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (error) {
      console.error('Checkin insert error:', error.message);
      return errorResponse(res, 'Failed to save check-in', 500);
    }

    const issuesLower = (issues || '').toLowerCase();
    const needsEscalation = /\b(pain|dizz|hurt|vomit|faint|eating disorder|binge|starv|nause)\b/.test(issuesLower);

    if (needsEscalation) {
      await notifyMaddy(
        'Health concern in check-in',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nIssue: ${issues}`
      );
    }

    const { count: missedCount } = await db
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client_id)
      .gte('week_no', parseInt(week_no) - 2);

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    await sendText(client.phone,
      `✅ Week ${week_no} check-in received! ${client.program === '12wk' ? "Your updated program is being generated — you'll get it shortly." : "Keep pushing! 💪"}`
    );

    return jsonResponse(res, { status: 'ok', checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return errorResponse(res, 'Internal error', 500);
  }
};
