import Anthropic from '@anthropic-ai/sdk';
import supabase from '../lib/supabase.js';
import { generateProgramPDF } from '../lib/pdf.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { escalateToMaddy } from '../lib/escalation.js';

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'under 800', 'starvation',
  'banned substance', 'steroid', 'ephedra', 'dnp', 'clenbuterol',
  'lose 10 kg in 1 week', 'lose 20 pounds in a week',
];

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: leadData } = client.lead_id
      ? await supabase.from('leads').select('first_msg').eq('id', client.lead_id).single()
      : { data: null };

    let intakeInfo = {};
    try {
      if (leadData?.first_msg) intakeInfo = JSON.parse(leadData.first_msg);
    } catch { /* not JSON intake */ }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildPrompt(client, week_no, recentCheckins, intakeInfo);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
      system: `You are a certified fitness program architect for FitnessByMaddy. Generate safe, effective, personalised weekly workout and nutrition plans. Output valid JSON only with keys: workout (with days array), nutrition (with calories, protein, carbs, fats, meals array, notes), and coach_notes string. Each day has: name, focus, exercises array. Each exercise has: name, sets, reps, rest, note. Each meal has: name, description. Never recommend extreme calorie restriction below 1200 kcal, banned substances, or unrealistic timelines.`,
    });

    const content = response.content[0]?.text || '';

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await escalateToMaddy('program_gen_failed', client.phone, 'Claude API returned non-JSON response');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const program = JSON.parse(jsonMatch[0]);

    const contentStr = JSON.stringify(program).toLowerCase();
    const flagged = SAFETY_FLAGS.some((flag) => contentStr.includes(flag));
    if (flagged) {
      await escalateToMaddy('unsafe_program_content', client.phone,
        `Week ${week_no} program flagged for safety review`);
      return res.status(200).json({ flagged: true, message: 'Program flagged for Maddy review' });
    }

    const pdfBuffer = await generateProgramPDF(
      client, week_no,
      program.workout, program.nutrition, program.coach_notes
    );

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage.from('programs').upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: urlData } = supabase.storage.from('programs').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || filePath;

    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: program.workout,
      nutrition_plan: program.nutrition,
      notes: program.coach_notes,
    });

    const contextNote = program.coach_notes
      ? program.coach_notes.slice(0, 150)
      : `Week ${week_no} program ready!`;

    await sendWhatsApp(
      client.phone,
      `${contextNote}\n\nYour Week ${week_no} program: ${pdfUrl}`,
      null,
      true
    );

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function buildPrompt(client, weekNo, checkins, intake) {
  let prompt = `Generate Week ${weekNo} program for client:\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake.age) prompt += `Age: ${intake.age}\n`;
  if (intake.goal) prompt += `Goal: ${intake.goal}\n`;
  if (intake.injuries) prompt += `Injuries/Limitations: ${intake.injuries}\n`;
  if (intake.diet_pref) prompt += `Diet Preference: ${intake.diet_pref}\n`;
  if (intake.experience) prompt += `Experience: ${intake.experience}\n`;
  if (intake.schedule) prompt += `Schedule: ${intake.schedule}\n`;

  if (checkins && checkins.length > 0) {
    prompt += '\nRecent check-in data:\n';
    for (const c of checkins) {
      prompt += `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, `;
      prompt += `compliance=${c.compliance_score}/10, energy=${c.energy}/10`;
      if (c.issues) prompt += `, issues: ${c.issues}`;
      if (c.next_week_focus) prompt += `, focus: ${c.next_week_focus}`;
      prompt += '\n';
    }
  }

  prompt += `\nDesign a ${weekNo === 1 ? 'foundation' : 'progressive'} week. `;
  prompt += 'Output JSON only with workout, nutrition, and coach_notes keys.';

  return prompt;
}
