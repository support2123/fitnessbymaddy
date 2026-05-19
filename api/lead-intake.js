import { createClient } from '../lib/supabase.js';
import { sendText } from '../lib/whatsapp.js';
import { parseBody, cors, maskPhone, classifyLead } from '../lib/helpers.js';

const REQUIRED_FIELDS = ['name', 'email', 'phone', 'age', 'primary_goal'];
const PHOTO_BUCKET = 'intake-photos';
const INTAKE_BUCKET = 'intake-photos'; // reuse same bucket, stored under /intakes/

export default async function handler(req, res) {
  try {
    // CORS
    if (cors(res)) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = await parseBody(req);

    // Validate required fields
    const missing = REQUIRED_FIELDS.filter((f) => !body[f]);
    if (missing.length > 0) {
      return res
        .status(400)
        .json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      height,
      current_weight,
      goal_weight,
      primary_goal,
      injuries,
      current_diet,
      diet_restrictions,
      workout_experience,
      gym_access,
      available_days,
      preferred_time,
      medications,
      anything_else,
      photos,
    } = body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const supabase = createClient();
    const masked = maskPhone(phone);

    console.log(`lead-intake: processing for lead ${lead_id} (${masked})`);

    // Classify program interest from primary_goal
    const programInterest = classifyLead(primary_goal);

    // Update lead record with name and program interest
    const { error: leadUpdateError } = await supabase
      .from('leads')
      .update({
        name,
        program_interest: programInterest,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    if (leadUpdateError) {
      console.error(
        `lead-intake: failed to update lead ${lead_id} (${masked}):`,
        leadUpdateError.message
      );
      return res.status(500).json({ error: 'Failed to update lead record' });
    }

    // Upload photos to Supabase Storage
    const photoUrls = [];
    if (Array.isArray(photos) && photos.length > 0) {
      for (let i = 0; i < photos.length; i++) {
        try {
          const photo = photos[i];
          const filePath = `${lead_id}/photo_${i + 1}.jpg`;

          let fileBody;
          let contentType = 'image/jpeg';

          if (photo.startsWith('http://') || photo.startsWith('https://')) {
            // URL — fetch the image first
            const imgRes = await fetch(photo);
            if (!imgRes.ok) {
              console.warn(
                `lead-intake: failed to fetch photo URL for ${masked}: ${imgRes.status}`
              );
              continue;
            }
            contentType = imgRes.headers.get('content-type') || 'image/jpeg';
            fileBody = Buffer.from(await imgRes.arrayBuffer());
          } else {
            // Base64 string — may include data URI prefix
            const base64Data = photo.replace(/^data:image\/\w+;base64,/, '');
            fileBody = Buffer.from(base64Data, 'base64');
          }

          const { error: uploadErr } = await supabase.storage
            .from(PHOTO_BUCKET)
            .upload(filePath, fileBody, {
              contentType,
              upsert: true,
            });

          if (uploadErr) {
            console.warn(
              `lead-intake: photo upload failed for ${masked} (${filePath}):`,
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
            `lead-intake: photo ${i + 1} processing error for ${masked}:`,
            photoErr.message
          );
        }
      }
    }

    // Store full intake data as JSON in Supabase Storage
    const intakeData = {
      lead_id,
      name,
      email,
      phone,
      age,
      gender: gender || null,
      height: height || null,
      current_weight: current_weight || null,
      goal_weight: goal_weight || null,
      primary_goal,
      injuries: injuries || null,
      current_diet: current_diet || null,
      diet_restrictions: diet_restrictions || null,
      workout_experience: workout_experience || null,
      gym_access: gym_access || null,
      available_days: available_days || [],
      preferred_time: preferred_time || null,
      medications: medications || null,
      anything_else: anything_else || null,
      photo_urls: photoUrls,
      submitted_at: new Date().toISOString(),
    };

    const intakeJson = JSON.stringify(intakeData, null, 2);
    const intakePath = `intakes/${lead_id}.json`;

    const { error: intakeUploadErr } = await supabase.storage
      .from(INTAKE_BUCKET)
      .upload(intakePath, Buffer.from(intakeJson, 'utf-8'), {
        contentType: 'application/json',
        upsert: true,
      });

    if (intakeUploadErr) {
      console.error(
        `lead-intake: failed to store intake JSON for ${masked}:`,
        intakeUploadErr.message
      );
      // Non-fatal — continue to send confirmation
    }

    // Send confirmation WhatsApp
    const confirmMsg = `Thanks ${name}! We've received your details. You'll get your program within 24 hours of payment.`;
    await sendText(phone, confirmMsg).catch((err) => {
      console.error(
        `lead-intake: WhatsApp confirmation failed for ${masked}:`,
        err.message
      );
    });

    console.log(`lead-intake: completed successfully for ${masked}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('lead-intake: unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
