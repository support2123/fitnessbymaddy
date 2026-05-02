const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { handleCors, maskPhone } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, goal,
      injuries, diet_pref, schedule, training_location
    } = req.body;

    if (!phone && !lead_id) {
      return res.status(400).json({ error: 'Phone or lead_id required' });
    }

    const db = getSupabase();
    let lead = null;

    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else if (phone) {
      const { data } = await db.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      if (phone) {
        const { data: newLead } = await db.from('leads').insert({
          phone,
          name,
          source: 'intake_form',
          status: 'qualified',
          program_interest: goal
        }).select().single();
        lead = newLead;
      } else {
        return res.status(404).json({ error: 'Lead not found' });
      }
    }

    await db.from('leads').update({
      name: name || lead.name,
      status: 'qualified',
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', lead.phone)
      .single();

    if (existingClient) {
      await db.from('clients').update({
        name: name || undefined,
        email: email || undefined,
        age: age ? parseInt(age) : undefined,
        goal: goal || undefined,
        injuries: injuries || undefined,
        diet_pref: diet_pref || undefined,
        schedule: schedule || undefined
      }).eq('id', existingClient.id);
    }

    console.log(`Intake form submitted: ${maskPhone(lead.phone)}, goal: ${goal}`);

    await sendTemplate(lead.phone, 'intake_received', [name || 'there']);

    return res.status(200).json({ ok: true, lead_id: lead.id });

  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
