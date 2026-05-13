const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { maskPhone } = require('./lib/mask-phone');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://www.fitnessbymaddy.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    return res.end();
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const client_id = body.client_id;
    const week_no = body.week_no;
    const weight = body.weight || body.current_weight_kg;
    const waist = body.waist || body.waist_cm;
    const compliance_score = body.compliance_score || body.workout_compliance;
    const energy = body.energy || body.energy_level;
    const issues = body.issues;
    const photos_urls = body.photos_urls;

    // 1. Validate required fields
    if (!client_id || week_no == null) {
      return res.status(400).json({ error: 'Missing required fields: client_id, week_no' });
    }

    const db = getSupabase();
    const weekNum = Number(week_no);

    // 2. Check if this week's checkin already exists
    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', weekNum)
      .limit(1)
      .single();

    const checkinRow = {
      client_id,
      week_no: weekNum,
      weight: weight != null ? Number(weight) : null,
      waist: waist != null ? Number(waist) : null,
      compliance_score: compliance_score != null ? Number(compliance_score) : null,
      energy: energy || null,
      issues: issues || null,
      photos_urls: photos_urls || null,
    };

    // 3. Insert or update into checkins table
    let dbError;
    if (existing?.id) {
      const { error } = await db
        .from('checkins')
        .update(checkinRow)
        .eq('id', existing.id);
      dbError = error;
    } else {
      const { error } = await db
        .from('checkins')
        .insert(checkinRow);
      dbError = error;
    }

    if (dbError) {
      console.error('Failed to save checkin:', dbError.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // 4. Check for escalation triggers in issues field
    const issueCheck = needsEscalation(issues);
    if (issueCheck.escalate) {
      const { data: client } = await db
        .from('clients')
        .select('phone, name')
        .eq('id', client_id)
        .single();

      await escalateToMaddy(`Check-in flagged: "${issueCheck.trigger}" in issues (week ${weekNum})`, {
        phone: client?.phone || 'unknown',
        name: client?.name || 'Unknown',
        message: `Week ${weekNum} issues: ${issues}`,
      });

      console.log(
        `Escalation triggered for client ${client_id} (${maskPhone(client?.phone)}): ${issueCheck.trigger}`
      );
    }

    // 5. If client is on 12wk program, trigger program generation
    const { data: client } = await db
      .from('clients')
      .select('phone, name, program')
      .eq('id', client_id)
      .single();

    if (client?.program === '12wk') {
      try {
        const protocol = process.env.VERCEL_URL ? 'https' : 'http';
        const host = process.env.VERCEL_URL || 'localhost:3000';
        await fetch(`${protocol}://${host}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: weekNum }),
        });
      } catch (genErr) {
        // Log but don't fail the check-in submission
        console.error('Failed to trigger program generation:', genErr.message);
      }
    }

    // 6. Send WhatsApp confirmation
    if (client?.phone) {
      await sendWhatsApp(
        client.phone,
        `Week ${weekNum} check-in received! Your updated plan will be ready within 24 hours.`,
        'checkin_confirmation'
      );
    }

    // 7. Return success
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
