import supabase from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      goal,
      injuries,
      diet_pref,
      schedule,
      experience,
      medical_conditions,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    let lead = null;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else if (phone) {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (lead.status === 'new') updateData.status = 'qualified';
    updateData.last_msg_at = new Date().toISOString();

    await supabase.from('leads').update(updateData).eq('id', lead.id);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existingClient) {
      await supabase
        .from('clients')
        .update({
          name: name || existingClient.name,
          email,
          age: age ? parseInt(age) : null,
          goal,
          injuries: [injuries, medical_conditions].filter(Boolean).join('; ') || null,
          diet_pref,
          schedule,
        })
        .eq('id', existingClient.id);
    }

    return res.status(200).json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
