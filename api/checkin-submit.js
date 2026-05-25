const { getSupabase } = require('./lib/supabase');
const { notifyMaddy } = require('./lib/escalation');
const { maskPhone } = require('./lib/helpers');

const PAIN_KEYWORDS = [
  'pain', 'injury', 'injured', 'hurt', 'sharp', 'strain', 'sprain',
  'swollen', 'swelling', 'torn', 'pull', 'ache', 'cramp', 'numb',
  'tingling', 'dislocate', 'fracture', 'break', 'snap',
];

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();

  try {
    // For multipart uploads, body may be parsed by Vercel's built-in parser
    // or we handle JSON for non-photo fields
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance,
      energy,
      issues,
    } = req.body || {};

    // Validate required fields
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const weekNum = parseInt(week_no, 10);
    if (isNaN(weekNum) || weekNum < 1 || weekNum > 52) {
      return res.status(400).json({ error: 'week_no must be between 1 and 52' });
    }

    // Verify client exists
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, phone, name, program')
      .eq('id', client_id)
      .maybeSingle();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Handle photo uploads
    const photoUrls = [];
    const photos = req.body?.photos || [];
    const photoArray = Array.isArray(photos) ? photos : [photos];

    for (let i = 0; i < photoArray.length; i++) {
      const photo = photoArray[i];
      if (!photo || !photo.data) continue;

      // Decode base64 photo data
      const buffer = Buffer.from(photo.data, 'base64');
      const ext = photo.type === 'image/png' ? 'png' : 'jpg';
      const filePath = `clients/${client_id}/checkin_w${weekNum}/photo_${i + 1}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('checkin-photos')
        .upload(filePath, buffer, {
          contentType: photo.type || 'image/jpeg',
          upsert: true,
        });

      if (uploadErr) {
        console.error(`Photo upload error [${maskPhone(client.phone)}]:`, uploadErr.message);
      } else {
        const { data: urlData } = supabase.storage
          .from('checkin-photos')
          .getPublicUrl(filePath);
        photoUrls.push(urlData?.publicUrl || filePath);
      }
    }

    // Update or insert check-in record (may exist as placeholder from cron)
    const checkinData = {
      client_id,
      week_no: weekNum,
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance ? parseInt(compliance, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photoUrls.length > 0 ? photoUrls : null,
    };

    const { data: checkin, error: insertErr } = await supabase
      .from('checkins')
      .upsert(checkinData, { onConflict: 'client_id,week_no' })
      .select()
      .single();

    if (insertErr) {
      console.error(`checkin-submit insert error [${maskPhone(client.phone)}]:`, insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Check for pain/injury keywords in issues
    if (issues) {
      const lower = issues.toLowerCase();
      const painMatches = PAIN_KEYWORDS.filter((kw) => lower.includes(kw));
      if (painMatches.length > 0) {
        await notifyMaddy(
          `Pain/injury reported in week ${weekNum} check-in`,
          `Client: ${client.name} (${maskPhone(client.phone)}). Keywords: ${painMatches.join(', ')}. Issues: ${issues}`
        );
      }
    }

    // Check for 2 consecutive missed check-ins
    if (weekNum >= 3) {
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client_id)
        .in('week_no', [weekNum - 1, weekNum - 2])
        .order('week_no', { ascending: false });

      const submittedWeeks = (recentCheckins || []).map((c) => c.week_no);
      const missedPrev = !submittedWeeks.includes(weekNum - 1);
      const missedPrevPrev = !submittedWeeks.includes(weekNum - 2);

      if (missedPrev && missedPrevPrev) {
        await notifyMaddy(
          `2 consecutive missed check-ins (weeks ${weekNum - 2} and ${weekNum - 1})`,
          `Client: ${client.name} (${maskPhone(client.phone)}). Program: ${client.program}. Current week submitted: ${weekNum}`
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Check-in submitted successfully',
      checkin_id: checkin?.id || null,
      photos_uploaded: photoUrls.length,
    });
  } catch (err) {
    console.error('checkin-submit error:', err.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
