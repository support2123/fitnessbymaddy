const { supabase } = require('./_lib/supabase');
const { generateWeeklyProgram } = require('./_lib/program-architect');
const { generateProgramPDF, uploadPDF } = require('./_lib/pdf-generator');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const { isHinglish, detectMarket } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: existingProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(200).json({ message: 'Program already exists', program_id: existingProgram.id });
    }

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { program, safe, violations } = await generateWeeklyProgram({
      client,
      checkins: (checkins || []).reverse(),
      weekNo: week_no
    });

    if (!safe) {
      await escalateToMaddy({
        reason: 'Program generation safety flag',
        phone: client.phone,
        details: `Week ${week_no} flagged: ${violations.join(', ')}`
      });
      return res.status(200).json({
        success: false,
        reason: 'safety_flagged',
        violations
      });
    }

    const pdfBuffer = await generateProgramPDF({
      clientName: client.name || 'Client',
      weekNo: week_no,
      workoutPlan: program.workout_plan,
      nutritionPlan: program.nutrition_plan,
      notes: program.notes
    });

    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    const { data: savedProgram, error: saveError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.notes
    }).select().single();

    if (saveError) throw saveError;

    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);

    const msgBody = hinglish
      ? [`Week ${week_no} ka program ready hai! 📋💪\n\n${program.notes || 'Is hafte bhi full effort dena hai!'}\n\nPDF: ${pdfUrl}`]
      : [`Your Week ${week_no} program is ready! 📋💪\n\n${program.notes || 'Give it your all this week!'}\n\nPDF: ${pdfUrl}`];

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      body: msgBody,
      isClient: true
    });

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', savedProgram.id);

    return res.status(200).json({
      success: true,
      program_id: savedProgram.id,
      pdf_url: pdfUrl
    });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
