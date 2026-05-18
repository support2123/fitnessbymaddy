const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, goal, injuries,
      diet_pref, schedule, phone,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      phone: phone || lead.phone,
      name: name || lead.name,
      email,
      age: age ? parseInt(age) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
    };

    const { data: existing } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existing) {
      await db.from('clients').update(intakeData).eq('id', existing.id);
    } else {
      intakeData.program = lead.program_interest || '6wk_gym';
      intakeData.status = 'active';
      await db.from('clients').insert(intakeData);
    }

    const allText = [goal, injuries, diet_pref].filter(Boolean).join(' ');
    if (needsEscalation(allText)) {
      await escalateToMaddy('Intake form flagged', {
        phone: maskPhone(lead.phone),
        injuries,
        goal,
      });
    }

    return res.json({ success: true, message: 'Intake saved' });
  } catch (err) {
    console.error('[lead-intake]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
