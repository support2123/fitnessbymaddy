const { getSupabase } = require('./lib/supabase');
const { notifyMaddy } = require('./lib/escalation');
const { maskPhone } = require('./lib/helpers');

const REQUIRED_FIELDS = ['name', 'email', 'phone', 'age', 'gender', 'goal'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

  try {
    const body = req.body || {};
    const { name, email, phone, age, gender, goal, activity_level, injuries, diet_preference, schedule, equipment, medical_conditions, notes } = body;

    const missing = REQUIRED_FIELDS.filter((f) => !body[f]);
    if (missing.length > 0) {
      return res.status(400).json({ error: 'Missing required fields', missing });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const ageNum = parseInt(age, 10);
    if (isNaN(ageNum) || ageNum < 13 || ageNum > 100) {
      return res.status(400).json({ error: 'Age must be between 13 and 100' });
    }

    const leadDetails = {
      age: ageNum,
      gender,
      goal,
      activity_level: activity_level || null,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      equipment: equipment || null,
      medical_conditions: medical_conditions || null,
      notes: notes || null,
      submitted_at: new Date().toISOString(),
    };

    const { data: lead, error: upsertErr } = await supabase
      .from('leads')
      .upsert(
        {
          phone,
          name,
          email,
          lead_details: leadDetails,
          status: 'qualified',
          last_msg_at: new Date().toISOString(),
        },
        { onConflict: 'phone' }
      )
      .select()
      .single();

    if (upsertErr) {
      console.error(`lead-intake upsert error for ${maskPhone(phone)}:`, upsertErr.message);
      return res.status(500).json({ error: 'Failed to save intake data' });
    }

    if (medical_conditions && medical_conditions.trim().length > 0) {
      await notifyMaddy(
        'Medical conditions reported on intake form',
        `Phone: ${maskPhone(phone)}, Conditions: ${medical_conditions}, Goal: ${goal}, Injuries: ${injuries || 'none'}`
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Intake form submitted successfully',
      lead_id: lead?.id || null,
    });
  } catch (err) {
    console.error(`lead-intake error [${maskPhone(req.body?.phone || '')}]:`, err.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
