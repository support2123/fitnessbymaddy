const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { maskPhone } = require('./lib/mask-phone');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://www.fitnessbymaddy.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
    const lead_id = body.lead_id;
    const age = body.age;
    const gender = body.gender;
    const height_cm = body.height_cm || body.height;
    const weight_kg = body.weight_kg || body.current_weight_kg;
    const goal = body.goal || body.primary_goal;
    const injuries = body.injuries;
    const medical_conditions = body.medical_conditions;
    const diet_preference = body.diet_preference;
    const training_experience = body.training_experience;
    const available_equipment = body.available_equipment;
    const weekly_schedule = body.weekly_schedule;
    const name = body.name || body.full_name;

    // 1. Validate required fields
    if (!lead_id || !age || !goal) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, age, goal' });
    }

    const db = getSupabase();

    // 2. Check for escalation triggers in injuries and medical_conditions
    const injuryCheck = needsEscalation(injuries);
    const medicalCheck = needsEscalation(medical_conditions);

    if (injuryCheck.escalate || medicalCheck.escalate) {
      // Look up lead phone for escalation context
      const { data: lead } = await db
        .from('leads')
        .select('phone, name')
        .eq('id', lead_id)
        .single();

      const trigger = injuryCheck.escalate ? injuryCheck.trigger : medicalCheck.trigger;
      const flaggedField = injuryCheck.escalate ? 'injuries' : 'medical_conditions';

      await escalateToMaddy(`Intake form flagged: "${trigger}" in ${flaggedField}`, {
        phone: lead?.phone || 'unknown',
        name: lead?.name || name || 'Unknown',
        message: `Injuries: ${injuries || 'none'} | Medical: ${medical_conditions || 'none'}`,
      });

      console.log(
        `Escalation triggered for lead ${lead_id} (${maskPhone(lead?.phone)}): ${trigger}`
      );
    }

    // 3. Insert into intake_submissions table
    const { error: insertError } = await db.from('intake_submissions').insert({
      lead_id,
      age: Number(age),
      gender: gender || null,
      height_cm: height_cm ? Number(height_cm) : null,
      weight_kg: weight_kg ? Number(weight_kg) : null,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference: diet_preference || null,
      training_experience: training_experience || null,
      available_equipment: available_equipment || null,
      weekly_schedule: weekly_schedule || null,
    });

    if (insertError) {
      console.error('Failed to insert intake submission:', insertError.message);
      return res.status(500).json({ error: 'Failed to save intake submission' });
    }

    // 4. Update the lead's name if provided
    if (name) {
      const { error: updateError } = await db
        .from('leads')
        .update({ name })
        .eq('id', lead_id);

      if (updateError) {
        console.error(`Failed to update lead name for ${lead_id}:`, updateError.message);
      }
    }

    // 5. Send confirmation WhatsApp to the lead
    const { data: lead } = await db
      .from('leads')
      .select('phone')
      .eq('id', lead_id)
      .single();

    if (lead?.phone) {
      await sendWhatsApp(
        lead.phone,
        "Thanks for filling in your details! We're reviewing your profile and will have your plan ready soon.",
        'intake_confirmation'
      );
    }

    // 6. Return success
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
