const { getSupabase } = require('../lib/supabase');
const { shouldEscalate, notifyMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, goal, injuries,
      diet_pref, schedule, phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    const query = lead_id
      ? db.from('leads').select('*').eq('id', lead_id).single()
      : db.from('leads').select('*').eq('phone', phone).single();

    const { data: lead, error } = await query;
    if (error || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead.id);
    }

    const intakeData = { age, goal, injuries, diet_pref, schedule, email };

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existingClient) {
      await db.from('clients').update({
        name: name || lead.name,
        email,
        age: age ? parseInt(age, 10) : null,
        goal,
        injuries,
        diet_pref,
        schedule,
      }).eq('id', existingClient.id);
    } else {
      await db.from('clients').insert({
        lead_id: lead.id,
        phone: lead.phone,
        name: name || lead.name,
        email,
        program: lead.program_interest,
        age: age ? parseInt(age, 10) : null,
        goal,
        injuries,
        diet_pref,
        schedule,
        status: 'active',
      });
    }

    if (injuries && shouldEscalate(injuries)) {
      await notifyMaddy('Medical flag on intake form', {
        phone: lead.phone,
        name: name || lead.name,
        injuries,
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[lead-intake]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
