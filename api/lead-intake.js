const { getSupabase } = require('../lib/supabase');
const { corsHeaders } = require('../lib/helpers');
const { needsEscalation } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
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
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_days,
      gym_access,
      schedule_preference,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy('Intake form — medical flag', {
        phone: phone || 'unknown',
        summary: `Injuries: ${injuries || 'none'}, Medical: ${medical_conditions || 'none'}`,
      });
    }

    if (lead_id) {
      await db.from('leads').update({
        name,
        status: 'qualified',
      }).eq('id', lead_id);
    }

    const intakeData = {
      age, gender, height, current_weight, goal_weight,
      goal, injuries, medical_conditions, diet_preference,
      workout_days, gym_access, schedule_preference,
    };

    const upsertPhone = phone || (lead_id
      ? (await db.from('leads').select('phone').eq('id', lead_id).single()).data?.phone
      : null);

    if (upsertPhone) {
      const { data: existing } = await db
        .from('clients')
        .select('id')
        .eq('phone', upsertPhone)
        .limit(1)
        .single();

      if (existing) {
        await db.from('clients').update({
          name, email,
          folder_url: JSON.stringify(intakeData),
        }).eq('id', existing.id);
      } else {
        await db.from('clients').insert({
          lead_id: lead_id || null,
          phone: upsertPhone,
          name, email,
          status: 'active',
          folder_url: JSON.stringify(intakeData),
        });
      }
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
