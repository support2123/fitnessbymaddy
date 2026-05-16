const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, phone } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    if (lead_id) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (age) updateData.age = parseInt(age);
    if (goal) updateData.goal = goal;
    if (injuries) updateData.injuries = injuries;
    if (diet_pref) updateData.diet_pref = diet_pref;
    if (schedule) updateData.schedule = schedule;

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      await supabase.from('clients').update(updateData).eq('id', existingClient[0].id);
    } else {
      const { data: lead } = await supabase
        .from('leads')
        .select('phone, program_interest')
        .eq('id', lead_id)
        .single();

      if (lead) {
        await supabase.from('clients').insert({
          lead_id,
          phone: lead.phone,
          program: lead.program_interest || '6wk_gym',
          status: 'active',
          ...updateData
        });
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
