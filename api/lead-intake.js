const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, schedule,
      medical_conditions, medications
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads')
      .select('id, phone, status')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    // Store intake data as a check-in week 0 (baseline) if client exists
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1);

    if (client && client.length > 0) {
      await supabase.from('checkins').upsert({
        client_id: client[0].id,
        week_no: 0,
        weight: weight || null,
        compliance_score: null,
        energy: null,
        issues: JSON.stringify({
          age, gender, height, goal, injuries,
          diet_preference, schedule, medical_conditions, medications
        }),
        next_week_focus: goal
      }, { onConflict: 'client_id,week_no' });

      // Update client email if provided
      if (email) {
        await supabase.from('clients').update({ email }).eq('id', client[0].id);
      }
    }

    return res.json({ ok: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
