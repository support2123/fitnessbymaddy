export const meta = {
  name: 'script-gauntlet',
  description: 'Four adversarial critics stress-test a reel script BEFORE VO and render (retention, facts, TTS-safety, brand)',
  whenToUse: 'Every DECODE episode: after the script draft, before generating any VO. args = {script, research, extra?}',
  phases: [{ title: 'Critique' }],
}

const SCRIPT = args?.script || ''
const RESEARCH = args?.research || '(no research pack provided — flag every uncited claim)'
const EXTRA = args?.extra || ''
if (!SCRIPT) throw new Error('args.script required — pass the numbered VO lines')

const CONTEXT = `PRODUCTION CONTEXT YOU MUST RESPECT:
- Instagram reel script for FitnessByMaddy (2.1M followers). Maddy is the coach, NASM-CPT, he/him always.
- Spoken by an ElevenLabs voice clone over a designed animation film (no talking head).
- HARD TTS RULES (violations have produced audible artifacts): NO em-dashes, NO ellipses, NO semicolons. Periods and commas only. Short sentences. The word "under" has been misheard as "on the" — avoid it. Avoid: calm, stress (bare), is talking, cant, high, under at critical spots.
- FBM brand: English only, secular, citation-first, anti-guru. No Hindi/Sanskrit/spiritual vocabulary, no medical claims, cures, or guaranteed results. Thin evidence is bounded in the same spoken beat, for example: "Thirty nine people. A signal, not a promise."
- The script declares Tier A, B, or C; it never pads a topic into a longer tier. Category must be clear by second three even when the exact lever is teased.
- One CTA voiced. It asks for one owned number and the last two seconds open a concrete loop for the next reel.
- The finished script must pass Viral 6/6: shareable, saveable, commentable, rewatch, screenshot, wait-for-next. ${EXTRA}`

phase('Critique')
const CRITIQUE = {
  type: 'object',
  properties: {
    critic: { type: 'string' },
    verdict: { type: 'string', description: 'SHIP_AS_IS or NEEDS_EDITS or MAJOR_REWRITE' },
    issues: { type: 'array', items: { type: 'object', properties: {
      line: { type: 'string' }, severity: { type: 'string', description: 'critical / major / minor' },
      problem: { type: 'string' }, fix: { type: 'string', description: 'exact replacement wording obeying TTS rules' },
    }, required: ['line', 'severity', 'problem', 'fix'] } },
    strongest_single_improvement: { type: 'string' },
  },
  required: ['critic', 'verdict', 'issues', 'strongest_single_improvement'],
}

const CRITICS = [
  { label: 'retention', prompt: 'You are a world-class short-form retention strategist. Adversarially judge: hook in under two seconds, category clear by second three, name-versus-tease choice, whether the selected Tier A/B/C is the shortest complete teaching shape, one distinct viewer question per beat, a new turn or visual reveal every four to six seconds, the single midpoint turn, owned-number comment friction, the final series loop, sound-off screenshot strength, and all six Viral 6/6 axes. Cite line numbers and propose exact rewrites.' },
  { label: 'facts', prompt: 'You are a rigorous exercise-science fact checker. Audit EVERY factual claim against the research pack: overstatements, misattributions, post-hoc causation ("so they..."), ranges stated as flat values, absolutes where the finding is "no significant change", protocol details wrong (what exactly did the study do), sample sizes, and anything a knowledgeable rival could screenshot. For each: CLAIM -> what research supports -> VERDICT (accurate/overstated/needs qualifier/wrong) -> corrected wording. Flag anything readable as a medical claim.' },
  { label: 'tts-safety', prompt: 'You are a TTS + speech-recognition QA specialist for an ElevenLabs clone pipeline verified by Whisper. Find: banned punctuation, breath-risk sentences, known mishear words, ambiguous numbers, homophone collisions, tense breaks mid-sentence, dangling pronouns ("it" with wrong referent), unstressed line endings, jargon-as-verb. Quote, explain the failure mode, give exact replacements.' },
  { label: 'brand', prompt: 'You are the FitnessByMaddy brand and compliance gate. Line-by-line: forbidden vocabulary (Hindi/Sanskrit/spiritual), pronouns (he/him), medical/cure/guarantee claims, advice that belongs with a clinician, guru register ("truth", preacher lines), talking down, honesty of the CTA, and screenshot-ammunition. Also judge: does it sound like a coach who read the papers or a listicle? Give the single strongest authority-raising improvement.' },
]

const out = await parallel(CRITICS.map(c => () =>
  agent(`${c.prompt}\n\n=== SCRIPT ===\n${SCRIPT}\n\n=== RESEARCH ===\n${RESEARCH}\n\n=== CONTEXT ===\n${CONTEXT}`,
    { label: c.label, phase: 'Critique', schema: CRITIQUE, effort: 'high' })))

const ok = out.filter(Boolean)
log(`critics: ${ok.map(r => r.verdict).join(' · ')}`)
return ok

