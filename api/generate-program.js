const { getSupabase } = require('../lib/supabase');
const { generateWeeklyProgram } = require('../lib/program-generator');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  try {
    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: lastCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      intake: client.intake_data,
      started_at: client.program_started_at,
    };

    const { program, flagged, flagReason } = await generateWeeklyProgram(
      clientProfile,
      lastCheckins || []
    );

    const { data: programRecord } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.context_note || null,
      flagged_for_review: flagged,
      review_reason: flagReason,
    }).select().single();

    if (flagged) {
      await escalateToMaddy(
        'Program flagged by safety filter',
        `Client: ${maskPhone(client.phone)}, Week ${week_no}\nReason: ${flagReason}\nProgram ID: ${programRecord.id}`
      );
      return res.status(200).json({
        ok: true, flagged: true,
        message: 'Program generated but held for review',
        program_id: programRecord.id,
      });
    }

    const contextNote = program.context_note || `Week ${week_no} program ready!`;
    const market = client.intake_data?.market || 'IN';
    const msg = market === 'IN'
      ? `Hey! Tumhara Week ${week_no} program ready hai. ${contextNote}\n\nWorkout aur nutrition plan check karo. Koi doubt ho toh message karo!`
      : `Hey! Your Week ${week_no} program is ready. ${contextNote}\n\nCheck your workout and nutrition plan. Message us if you have any questions!`;

    await sendWhatsApp(client.phone, msg);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', programRecord.id);

    return res.status(200).json({
      ok: true,
      program_id: programRecord.id,
      flagged: false,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};
