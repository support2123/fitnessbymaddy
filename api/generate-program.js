import Anthropic from '@anthropic-ai/sdk';
import supabase from '../lib/supabase.js';
import { sendDocument } from '../lib/whatsapp.js';
import { generateProgramPDF } from '../lib/program-pdf.js';
import { maskPhone } from '../lib/market.js';

const SAFETY_FLAGS = [
  'extreme calorie', 'below 800', 'below 1000', 'starvation',
  'clenbuterol', 'dnp', 'steroids', 'sarms', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in',
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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get lead intake data
    const { data: lead } = await supabase
      .from('leads')
      .select('first_msg')
      .eq('id', client.lead_id)
      .single();

    let intakeData = {};
    try {
      intakeData = JSON.parse(lead?.first_msg || '{}');
    } catch { /* intake not JSON */ }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildPrompt(client, intakeData, checkins || [], week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
      system: `You are a certified fitness program architect for FitnessByMaddy. You create science-backed, safe, personalised workout and nutrition plans. Output ONLY valid JSON matching the specified schema. Never recommend dangerous practices, extreme calorie deficits (<1200 for women, <1500 for men), banned substances, or unrealistic timelines.`,
    });

    const content = message.content[0].text;
    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      console.error('Failed to parse Claude response');
      return res.status(500).json({ error: 'Invalid program output' });
    }

    // Safety check
    const fullText = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_FLAGS.some(f => fullText.includes(f));
    if (flagged) {
      const { escalateToMaddy } = await import('../lib/escalation.js');
      await escalateToMaddy(client.phone, 'unsafe_program_content', `Week ${week_no} program flagged for safety review`);

      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: `FLAGGED FOR REVIEW: ${parsed.notes || ''}`,
      });

      return res.status(200).json({ action: 'flagged_for_review', week_no });
    }

    // Generate PDF
    const pdfUrl = await generateProgramPDF(
      client,
      week_no,
      parsed.workout_plan,
      parsed.nutrition_plan,
      parsed.notes
    );

    // Store in programs table
    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes,
    });

    // Send via WhatsApp
    const caption = parsed.one_liner || `Your Week ${week_no} program is ready! Let's crush it 💪`;
    const sendResult = await sendDocument(client.phone, pdfUrl, caption, true);

    if (sendResult.ok) {
      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', week_no);
    }

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function buildPrompt(client, intake, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  let context = `Client: ${client.name || 'Anonymous'}
Program: ${client.program}
Week: ${weekNo} of 12
`;

  if (intake.age) context += `Age: ${intake.age}, Gender: ${intake.gender || 'not specified'}\n`;
  if (intake.weight) context += `Starting weight: ${intake.weight}kg\n`;
  if (intake.goal) context += `Goal: ${intake.goal}\n`;
  if (intake.injuries) context += `Injuries/limitations: ${intake.injuries}\n`;
  if (intake.diet_preference) context += `Diet preference: ${intake.diet_preference}\n`;
  if (intake.schedule) context += `Available days: ${intake.schedule}\n`;
  if (intake.experience_level) context += `Experience: ${intake.experience_level}\n`;

  if (lastCheckin) {
    context += `\nLatest check-in (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'}kg
- Waist: ${lastCheckin.waist || 'N/A'}cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}
- Focus: ${lastCheckin.next_week_focus || 'N/A'}`;
  }

  if (prevCheckin) {
    context += `\n\nPrevious check-in (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
- Energy: ${prevCheckin.energy || 'N/A'}/10`;
  }

  return `${context}

Create a personalised Week ${weekNo} program based on the client data above. Respond with ONLY a JSON object matching this schema:

{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "optional form cue" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fat": 70 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "options": ["Option A description", "Option B description"] }
    ]
  },
  "notes": "Brief coach notes about this week's focus and progression",
  "one_liner": "Short motivational message to send with the program"
}

Adjust based on compliance, energy, weight trend, and any issues reported. If compliance is low, simplify. If energy is low, reduce volume. Progress logically from previous weeks.`;
}
