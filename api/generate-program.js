const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(client, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;
    let programData;

    try {
      programData = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        programData = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('Failed to parse program JSON from Claude response');
      }
    }

    if (hasSafetyIssues(programData)) {
      await escalateToMaddy('unsafe_program', {
        phone: client.phone,
        message: `Generated program for week ${week_no} flagged for safety review`
      });
      return res.status(200).json({ success: false, reason: 'flagged_for_review' });
    }

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes || null
    }).select().single();

    if (error) throw error;

    const contextNote = programData.notes || `Week ${week_no} program ready!`;
    await sendTemplate(client.phone, 'program_ready', [
      client.name || 'there',
      String(week_no),
      contextNote
    ]);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildSystemPrompt() {
  return `You are a NASM-certified personal trainer and nutrition coach creating weekly training programs for FitnessByMaddy clients.

Rules:
- Programs must be safe, evidence-based, and progressive
- Never prescribe calories below 1200 for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Consider injuries, preferences, and compliance history
- Output ONLY valid JSON with this structure:
{
  "workout_plan": { "days": [...], "notes": "..." },
  "nutrition_plan": { "calories": N, "protein_g": N, "carbs_g": N, "fats_g": N, "meals": [...], "notes": "..." },
  "notes": "One-liner context for the client"
}

Each workout day: { "day": "Monday", "focus": "Upper Body", "exercises": [{ "name": "...", "sets": N, "reps": "8-12", "rest": "60s", "notes": "" }] }
Each meal: { "meal": "Breakfast", "options": ["..."], "macros": "..." }`;
}

function buildUserPrompt(client, checkins, weekNo) {
  const checkinSummary = checkins && checkins.length > 0
    ? checkins.map(c => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues: ${c.issues || 'none'}`).join('\n')
    : 'No previous check-ins yet (first week).';

  return `Create Week ${weekNo} program for this client:

Name: ${client.name || 'Client'}
Program: ${client.program}
Goal: ${client.goal || 'general fitness'}
Age: ${client.age || 'unknown'}
Injuries/limitations: ${client.injuries || 'none reported'}
Diet preference: ${client.diet_pref || 'no preference'}
Schedule: ${client.schedule || 'flexible'}

Recent check-in data:
${checkinSummary}

Generate the next week's workout and nutrition plan. Adjust based on compliance, energy, and any reported issues. Progressive overload from previous week if compliance was 7+.`;
}

function hasSafetyIssues(programData) {
  if (!programData) return true;

  const nutrition = programData.nutrition_plan;
  if (nutrition && nutrition.calories && nutrition.calories < 1200) return true;

  const notes = JSON.stringify(programData).toLowerCase();
  const banned = ['steroid', 'dnp', 'clenbuterol', 'sarm', 'hgh injection', 'ephedra'];
  if (banned.some(term => notes.includes(term))) return true;

  if (nutrition && nutrition.calories && nutrition.calories < 800) return true;

  return false;
}
