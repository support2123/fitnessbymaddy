const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendDocument, sendText, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'dangerous', 'not recommended by medical'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const sb = getSupabase();

    // Load client
    const { data: client } = await sb.from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Load last 2 check-ins
    const { data: checkins } = await sb
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Load lead data for intake info
    const { data: lead } = await sb.from('leads').select('first_msg').eq('id', client.lead_id).single();
    let intakeData = null;
    try { intakeData = lead?.first_msg ? JSON.parse(lead.first_msg) : null; } catch {}

    // Build prompt
    const prompt = buildPrompt(client, checkins || [], intakeData, week_no);

    // Call Claude
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0]?.text || '';

    // Parse JSON from response
    let programData;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      await notifyMaddy(`Program gen failed to parse JSON for ${maskPhone(client.phone)} Week ${week_no}`);
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    // Safety check
    const fullText = JSON.stringify(programData).toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (fullText.includes(flag)) {
        await notifyMaddy(
          `⚠️ Program flagged for safety review:\n` +
          `Client: ${client.name || maskPhone(client.phone)}\n` +
          `Week: ${week_no}\nFlag: "${flag}"`
        );
        return res.json({ success: false, reason: 'safety_flagged', flag });
      }
    }

    // Generate PDF
    const pdfBuffer = await generateProgramPDF(
      client,
      week_no,
      programData.workout || programData.workout_plan || {},
      programData.nutrition || programData.nutrition_plan || {},
      programData.notes || ''
    );

    // Upload to Supabase Storage
    const pdfPath = `clients/${client.id}/week_${week_no}.pdf`;
    await sb.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: publicUrl } = sb.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = publicUrl?.publicUrl || '';

    // Store in programs table
    await sb.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout || programData.workout_plan || {},
      nutrition_plan: programData.nutrition || programData.nutrition_plan || {},
      notes: programData.notes || ''
    }, { onConflict: 'client_id,week_no' });

    // Send via WhatsApp
    const market = detectMarket(client.phone);
    const contextNote = programData.context_note ||
      `Week ${week_no} program based on your latest check-in.`;

    if (pdfUrl) {
      await sendDocument(client.phone, pdfUrl, contextNote);
    }

    if (isHinglish(market)) {
      await sendText(client.phone,
        `Tumhara Week ${week_no} program ready hai! 📄\n\n` +
        `${contextNote}\n\nQuestions ho toh message karo. Let's go! 💪`
      );
    } else {
      await sendText(client.phone,
        `Your Week ${week_no} program is ready! 📄\n\n` +
        `${contextNote}\n\nAny questions, just message us. Let's go! 💪`
      );
    }

    // Update programs table with send timestamp
    await sb.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.json({ success: true, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, intake, weekNo) {
  const latestCheckin = checkins[0];
  const prevCheckin = checkins[1];

  let prompt = `You are a program architect for FitnessByMaddy, an elite online fitness coaching brand.
Generate a week ${weekNo} training and nutrition program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'N/A'}
- Program: ${client.program}
- Started: ${client.program_started_at}
`;

  if (intake) {
    prompt += `
INTAKE DATA:
- Age: ${intake.age || 'N/A'}
- Gender: ${intake.gender || 'N/A'}
- Goal: ${intake.goal || 'N/A'}
- Injuries: ${intake.injuries || 'None reported'}
- Diet preference: ${intake.diet_preference || 'N/A'}
- Schedule: ${intake.schedule || 'N/A'}
- Experience: ${intake.experience_level || 'N/A'}
- Medical conditions: ${intake.medical_conditions || 'None reported'}
`;
  }

  if (latestCheckin) {
    prompt += `
LATEST CHECK-IN (Week ${latestCheckin.week_no}):
- Weight: ${latestCheckin.weight || 'N/A'} kg
- Waist: ${latestCheckin.waist || 'N/A'} cm
- Compliance: ${latestCheckin.compliance_score || 'N/A'}/10
- Energy: ${latestCheckin.energy || 'N/A'}/10
- Issues: ${latestCheckin.issues || 'None'}
`;
  }

  if (prevCheckin) {
    prompt += `
PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Waist: ${prevCheckin.waist || 'N/A'} cm
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
- Energy: ${prevCheckin.energy || 'N/A'}/10
`;
  }

  prompt += `
OUTPUT FORMAT (respond with ONLY valid JSON, wrapped in \`\`\`json code block):
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "notes": "2min rest" }
        ]
      }
    ]
  },
  "nutrition": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fats": 65 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "4 eggs, 2 toast, 1 banana" }
    ]
  },
  "notes": "Focus on progressive overload this week. Increase bench by 2.5kg.",
  "context_note": "Based on your check-in, we've adjusted volume slightly."
}

RULES:
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Be specific with exercise selection, sets, reps, and rest periods
- Adjust based on check-in data (compliance, energy, weight trends)
- Include 4-6 training days with appropriate volume
- Meals should be practical and culturally appropriate for the client's market
`;

  return prompt;
}
