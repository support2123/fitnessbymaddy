import { createClient } from '../lib/supabase.js';
import { sendText } from '../lib/whatsapp.js';
import { parseBody, cors, maskPhone, isEscalation } from '../lib/helpers.js';

const PHOTO_BUCKET = 'checkin-photos';
const MADDY_PHONE = process.env.MADDY_PHONE;

export default async function handler(req, res) {
  try {
    // CORS
    if (cors(res)) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = await parseBody(req);

    // Validate required fields
    const { client_id, week_no } = body;
    if (!client_id) {
      return res.status(400).json({ error: 'Missing client_id' });
    }
    if (week_no == null || week_no === '') {
      return res.status(400).json({ error: 'Missing week_no' });
    }

    const supabase = createClient();

    // Verify client exists and is active
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, phone, name, status')
      .eq('id', client_id)
      .maybeSingle();

    if (clientErr) {
      console.error(
        `checkin-submit: client lookup error for ${client_id}:`,
        clientErr.message
      );
      return res.status(500).json({ error: 'Failed to verify client' });
    }

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res
        .status(403)
        .json({ error: 'Client account is not active' });
    }

    const masked = maskPhone(client.phone);
    console.log(
      `checkin-submit: processing week ${week_no} for client ${client_id} (${masked})`
    );

    const {
      weight,
      waist,
      compliance_score,
      energy,
      sleep_quality,
      stress_level,
      meals_on_plan,
      workouts_completed,
      biggest_win,
      struggles,
      pain_or_issues,
      notes_for_coach,
      photos,
    } = body;

    // Check for escalation keywords in pain_or_issues and struggles
    const combinedConcerns = [pain_or_issues, struggles]
      .filter(Boolean)
      .join(' ');

    if (combinedConcerns && isEscalation(combinedConcerns)) {
      console.warn(
        `checkin-submit: escalation detected for client ${client_id} (${masked}) week ${week_no}`
      );

      if (MADDY_PHONE) {
        const escalationMsg =
          `ESCALATION: Client ${client.name || client_id} (Week ${week_no}) ` +
          `reported concerning issues:\n\n` +
          `Pain/Issues: ${pain_or_issues || 'N/A'}\n` +
          `Struggles: ${struggles || 'N/A'}`;

        await sendText(MADDY_PHONE, escalationMsg).catch((err) => {
          console.error(
            'checkin-submit: failed to send escalation alert:',
            err.message
          );
        });
      } else {
        console.warn(
          'checkin-submit: MADDY_PHONE not set, cannot send escalation alert'
        );
      }
    }

    // Upload photos to Supabase Storage
    const photoUrls = [];
    if (Array.isArray(photos) && photos.length > 0) {
      for (let i = 0; i < photos.length; i++) {
        try {
          const photo = photos[i];
          const filePath = `${client_id}/week_${week_no}/photo_${i + 1}.jpg`;

          // Base64 string — may include data URI prefix
          const base64Data = photo.replace(/^data:image\/\w+;base64,/, '');
          const fileBody = Buffer.from(base64Data, 'base64');

          const { error: uploadErr } = await supabase.storage
            .from(PHOTO_BUCKET)
            .upload(filePath, fileBody, {
              contentType: 'image/jpeg',
              upsert: true,
            });

          if (uploadErr) {
            console.warn(
              `checkin-submit: photo upload failed for ${masked} week ${week_no} (${filePath}):`,
              uploadErr.message
            );
            continue;
          }

          const { data: urlData } = supabase.storage
            .from(PHOTO_BUCKET)
            .getPublicUrl(filePath);

          if (urlData?.publicUrl) {
            photoUrls.push(urlData.publicUrl);
          }
        } catch (photoErr) {
          console.warn(
            `checkin-submit: photo ${i + 1} processing error for ${masked}:`,
            photoErr.message
          );
        }
      }
    }

    // Combine pain_or_issues and struggles into issues field
    const issues = [pain_or_issues, struggles].filter(Boolean).join(' | ');

    // Insert into checkins table
    const { data: checkin, error: insertErr } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: Number(week_no),
        weight: weight != null ? Number(weight) : null,
        waist: waist != null ? Number(waist) : null,
        compliance_score:
          compliance_score != null ? Number(compliance_score) : null,
        energy: energy != null ? Number(energy) : null,
        sleep_quality: sleep_quality || null,
        stress_level: stress_level || null,
        meals_on_plan: meals_on_plan != null ? Number(meals_on_plan) : null,
        workouts_completed:
          workouts_completed != null ? Number(workouts_completed) : null,
        biggest_win: biggest_win || null,
        issues: issues || null,
        notes_for_coach: notes_for_coach || null,
        photos_urls: photoUrls,
        next_week_focus: null,
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error(
        `checkin-submit: insert failed for ${masked} week ${week_no}:`,
        insertErr.message
      );
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Send confirmation WhatsApp to client
    if (client.phone) {
      const confirmMsg = `Check-in received for Week ${week_no}! Your updated program will be sent within 24 hours.`;
      await sendText(client.phone, confirmMsg).catch((err) => {
        console.error(
          `checkin-submit: WhatsApp confirmation failed for ${masked}:`,
          err.message
        );
      });
    }

    console.log(
      `checkin-submit: completed successfully for ${masked} week ${week_no} (checkin ${checkin.id})`
    );

    return res.status(200).json({
      success: true,
      checkin_id: checkin.id,
    });
  } catch (err) {
    console.error('checkin-submit: unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
