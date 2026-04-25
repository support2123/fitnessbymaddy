const { getSupabase } = require('./_lib/supabase');
const { corsHeaders } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      name, email, phone, age, gender, goal, injuries,
      diet_pref, schedule, program, experience, message,
    } = req.body;

    if (!phone && !email) {
      return res.status(400).json({ error: 'Phone or email required' });
    }

    const cleanPhone = phone ? phone.replace(/[^0-9+]/g, '') : null;

    if (cleanPhone) {
      const { data: lead } = await db
        .from('leads')
        .select('id')
        .eq('phone', cleanPhone)
        .single();

      if (lead) {
        await db.from('leads').update({
          name: name || undefined,
          program_interest: program || undefined,
          status: 'qualified',
          last_msg_at: new Date().toISOString(),
        }).eq('id', lead.id);
      } else {
        await db.from('leads').insert({
          phone: cleanPhone,
          name,
          source: 'intake_form',
          status: 'qualified',
          program_interest: program || null,
          first_msg: `Intake: ${goal || ''} | ${experience || ''}`,
        });
      }
    }

    return res.json({
      ok: true,
      message: 'Intake received. Welcome to FitnessByMaddy!',
    });
  } catch (err) {
    console.error('[Intake] Error:', err.message);
    return res.status(500).json({ error: 'Submission failed' });
  }
};
