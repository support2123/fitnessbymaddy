// POST /api/checkin-submit
// Handles weekly check-in form submissions from clients.

const { supabase } = require('./lib/supabase');
const { maskPhone } = require('./lib/whatsapp');
const { needsEscalation, createEscalation } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
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
      nutrition_rating,
      issues,
      wins,
      adjustments,
      photos // array of base64 strings or URLs
    } = req.body || {};

    // 1. Validate required fields
    if (!client_id || week_no == null) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    // 2. Look up client — must exist and be active
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, phone, name, program, status')
      .eq('id', client_id)
      .single();

    if (clientError || !client) {
      console.log(`Check-in rejected: client not found (${client_id})`);
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      console.log(`Check-in rejected: client not active (${maskPhone(client.phone)})`);
      return res.status(403).json({ error: 'Client account is not active' });
    }

    // Treat photos as an array of URLs (store as text[])
    const photosUrls = Array.isArray(photos) ? photos : [];

    // Build the row to upsert
    const checkinRow = {
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight != null ? parseFloat(weight) : null,
      waist: waist != null ? parseFloat(waist) : null,
      compliance_score: compliance_score != null ? parseInt(compliance_score, 10) : null,
      energy: energy != null ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photosUrls,
      // Store wins, adjustments, nutrition_rating in next_week_focus as structured note
      next_week_focus: [
        wins ? `Wins: ${wins}` : null,
        adjustments ? `Adjustments: ${adjustments}` : null,
        nutrition_rating != null ? `Nutrition rating: ${nutrition_rating}` : null
      ]
        .filter(Boolean)
        .join('\n') || null,
      form_submitted_at: new Date().toISOString()
    };

    // 3. Check for existing check-in (upsert: update if duplicate, insert if new)
    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no, 10))
      .maybeSingle();

    let checkinId;

    if (existing) {
      // Update existing record
      const { data: updated, error: updateError } = await supabase
        .from('checkins')
        .update(checkinRow)
        .eq('id', existing.id)
        .select('id')
        .single();

      if (updateError) {
        console.error('Failed to update check-in:', updateError.message);
        return res.status(500).json({ error: 'Failed to update check-in' });
      }

      checkinId = updated.id;
      console.log(`Check-in updated for ${maskPhone(client.phone)}, week ${week_no}`);
    } else {
      // 4. Insert new check-in
      const { data: inserted, error: insertError } = await supabase
        .from('checkins')
        .insert(checkinRow)
        .select('id')
        .single();

      if (insertError) {
        console.error('Failed to insert check-in:', insertError.message);
        return res.status(500).json({ error: 'Failed to save check-in' });
      }

      checkinId = inserted.id;
      console.log(`Check-in created for ${maskPhone(client.phone)}, week ${week_no}`);
    }

    // 5. Check if issues text triggers escalation
    if (issues) {
      const keyword = needsEscalation(issues);
      if (keyword) {
        console.log(`Escalation triggered for ${maskPhone(client.phone)}: keyword="${keyword}"`);
        await createEscalation(client.phone, keyword, issues, client_id);
      }
    }

    // 6. If client is on 12-week program, trigger next-week program generation
    if (client.program === '12wk') {
      const nextWeek = parseInt(week_no, 10) + 1;
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

      // Fire-and-forget: non-blocking internal call
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Pass internal secret so generate-program can trust this call
          Authorization: `Bearer ${process.env.CRON_SECRET || ''}`
        },
        body: JSON.stringify({ client_id, week_no: nextWeek })
      }).catch((err) => {
        console.error('generate-program trigger failed:', err.message);
      });

      console.log(`Program generation triggered for ${maskPhone(client.phone)}, week ${nextWeek}`);
    }

    return res.status(200).json({ success: true, message: 'Check-in received', checkin_id: checkinId });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
