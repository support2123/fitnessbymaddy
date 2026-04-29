const { getSupabase } = require('./_lib/supabase');
const { checkEscalation } = require('./_lib/escalation');
const { notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const {
      lead_id,
      name,
      phone,
      email,
      age,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_schedule,
      current_weight,
      target_weight,
      experience_level
    } = req.body;

    if (!phone && !lead_id) {
      return res.status(400).json({ error: 'Phone number or lead ID required' });
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    const escalation = checkEscalation(medicalText);

    if (lead_id) {
      await db.from('leads')
        .update({
          name: name || undefined,
          status: 'qualified',
          last_msg_at: new Date().toISOString()
        })
        .eq('id', lead_id);
    }

    const intakeData = {
      lead_id: lead_id || null,
      phone,
      name,
      email,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference: diet_preference || null,
      workout_schedule: workout_schedule || null,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      experience_level: experience_level || null,
      submitted_at: new Date().toISOString()
    };

    const { error: insertError } = await db
      .from('lead_intakes')
      .insert(intakeData);

    if (insertError && insertError.code === '42P01') {
      await db.rpc('exec_sql', {
        sql: `CREATE TABLE IF NOT EXISTS lead_intakes (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          lead_id UUID REFERENCES leads(id),
          phone TEXT,
          name TEXT,
          email TEXT,
          age INTEGER,
          gender TEXT,
          goal TEXT,
          injuries TEXT,
          medical_conditions TEXT,
          diet_preference TEXT,
          workout_schedule TEXT,
          current_weight NUMERIC,
          target_weight NUMERIC,
          experience_level TEXT,
          submitted_at TIMESTAMPTZ DEFAULT now()
        )`
      });
      await db.from('lead_intakes').insert(intakeData);
    }

    if (escalation.escalate) {
      await notifyMaddy(
        `Intake form: medical flag (${escalation.reason})`,
        `Name: ${name}\nPhone: ${maskPhone(phone)}\nInjuries: ${injuries || 'None'}\nConditions: ${medical_conditions || 'None'}`
      );
    }

    return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });

  } catch (err) {
    console.error('Intake error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
