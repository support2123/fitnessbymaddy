const { getClient } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getClient();

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule, medical_conditions,
      current_weight, height, program
    } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Name, email, and phone are required' });
    }

    const allText = [goal, injuries, medical_conditions, diet_pref].filter(Boolean).join(' ');
    if (needsEscalation(allText)) {
      await escalateToMaddy('Medical/injury flag on intake form', {
        phone, name, message: allText
      });
    }

    if (lead_id) {
      await db.from('leads').update({
        name,
        status: 'qualified',
        program_interest: program || null,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead_id);
    } else {
      const { data: existing } = await db
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .limit(1)
        .maybeSingle();

      if (!existing) {
        await db.from('leads').insert({
          phone,
          name,
          source: 'intake_form',
          status: 'qualified',
          program_interest: program || null,
          market: 'GLOBAL',
          first_msg: `Intake form: ${goal || ''}`,
          last_msg_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        });
      } else {
        await db.from('leads').update({
          name,
          status: 'qualified',
          program_interest: program || null,
          last_msg_at: new Date().toISOString()
        }).eq('id', existing.id);
      }
    }

    return res.status(200).json({ success: true, message: 'Intake received' });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
