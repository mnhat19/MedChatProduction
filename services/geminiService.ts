import { GoogleGenerativeAI } from "@google/generative-ai";
import { SYSTEM_INSTRUCTION, VIRTUAL_PATIENT_INSTRUCTION, EVALUATOR_INSTRUCTION, CLINICAL_SYSTEMS, DIFFICULTY_LEVELS, COMMON_DISEASES } from "../constants";
import { Message, CaseConfig, PatientInfo, TrainingSession, DiagnosisSubmission, EvaluationResult, ClinicalSystem, DifficultyLevel, AgeGroup } from "../types";

// ── Model fallback cascade ───────────────────────────────────────────────────
// Try models in order; each has independent quota even for the same API key.
// gemini-2.0-flash: 15 RPM, 1500 RPD  (primary)
// gemini-2.0-flash-lite: 30 RPM, 1500 RPD (lighter quota pool)
// gemini-1.5-flash-8b: 15 RPM, 1500 RPD
// gemini-1.5-flash:  15 RPM, 1500 RPD  (last resort)
const MODEL_FALLBACKS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];
const MODEL_NAME = MODEL_FALLBACKS[0]; // exported constant kept for legacy use

// ── Gemini multi-key + multi-model rotation ───────────────────────────────────
const _isRateLimit = (err: any): boolean => {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  return err?.status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('rate limit');
};
const _isDailyQuota = (err: any): boolean => {
  const msg = String(err?.message ?? '').toLowerCase();
  // RESOURCE_EXHAUSTED = daily/total quota, not per-minute
  return msg.includes('billing') || msg.includes('exceeded your current quota') || msg.includes('resource_exhausted');
};

const _isModelNotFound = (err: any): boolean => {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  // 404 = model deprecated/unavailable — skip all combos for this model name
  return msg.includes('not found') || msg.includes('not supported for generatecontent') ||
    (msg.includes('404') && (msg.includes('model') || msg.includes('models/')));
};

class GeminiKeyManager {
  private keys: string[];
  // cooldowns keyed as `key::model` → expiry timestamp
  private cooldowns = new Map<string, number>();
  private clients = new Map<string, GoogleGenerativeAI>();

  constructor() {
    const env = import.meta.env;
    const candidates = [
      env.VITE_GEMINI_API_KEY_1, env.VITE_GEMINI_API_KEY_2, env.VITE_GEMINI_API_KEY_3,
      env.VITE_GEMINI_API_KEY, // legacy / single-key fallback
    ].filter(Boolean) as string[];
    this.keys = [...new Set(candidates)];
    if (this.keys.length === 0) {
      console.warn('[GeminiKeyManager] No Gemini API keys configured — will use Groq fallback.');
    } else {
      console.log(`[GeminiKeyManager] ${this.keys.length} key(s) loaded`);
    }
  }

  getClient(key: string): GoogleGenerativeAI {
    if (!this.clients.has(key)) this.clients.set(key, new GoogleGenerativeAI(key));
    return this.clients.get(key)!;
  }

  isAvailable(key: string, model: string): boolean {
    return Date.now() >= (this.cooldowns.get(`${key}::${model}`) ?? 0);
  }

  markRateLimited(key: string, model: string, isDaily: boolean): void {
    // Daily quota runs out until midnight — use 2-hour cooldown so we don't hammer
    // Per-minute rate limits reset in ~60s — use 65s cooldown
    const cooldownMs = isDaily ? 2 * 60 * 60 * 1000 : 65_000;
    this.cooldowns.set(`${key}::${model}`, Date.now() + cooldownMs);
    console.warn(`[Gemini] Key …${key.slice(-6)} + ${model} cooled ${isDaily ? '2hr (daily quota)' : '65s (RPM)'}`);
  }

  /** Returns all (key, model) pairs in priority order, skipping cooled-down combos first. */
  getCombos(): Array<{ key: string; model: string }> {
    const all: Array<{ key: string; model: string }> = [];
    for (const model of MODEL_FALLBACKS) {
      for (const key of this.keys) {
        all.push({ key, model });
      }
    }
    // Available combos first, cooled-down combos appended at end as last resort
    const available = all.filter(c => this.isAvailable(c.key, c.model));
    const cooled   = all.filter(c => !this.isAvailable(c.key, c.model));
    return [...available, ...cooled];
  }
}

// Lazily initialized — safe even when no Gemini keys are configured
let _km: GeminiKeyManager | null = null;
const getKm = (): GeminiKeyManager => {
  if (!_km) _km = new GeminiKeyManager();
  return _km;
};

const _sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Try all (key, model) combinations in cascade order.
 * fn receives the GoogleGenerativeAI client and the active model name.
 * On 429 the combo is cooled down and the next one is tried immediately.
 * If no Gemini keys are configured, skips straight to the "all exhausted" path
 * which triggers the Groq fallback in each call site.
 */
async function withRetry<T>(fn: (client: GoogleGenerativeAI, model: string) => Promise<T>): Promise<T> {
  const km = getKm();
  const combos = km.getCombos(); // empty array when no keys configured
  const deprecatedModels = new Set<string>(); // 404 models to skip for this request
  let lastErr: any;

  for (const { key, model } of combos) {
    if (!km.isAvailable(key, model)) continue; // skip still-cooled combos
    if (deprecatedModels.has(model)) continue;  // skip 404-known models
    try {
      return await fn(km.getClient(key), model);
    } catch (err: any) {
      if (_isRateLimit(err)) {
        km.markRateLimited(key, model, _isDailyQuota(err));
        lastErr = err;
        await _sleep(300); // tiny pause before trying next combo
        continue;
      }
      if (_isModelNotFound(err)) {
        deprecatedModels.add(model);
        console.warn(`[Gemini] Model ${model} returned 404 — skipping all its combos`);
        lastErr = err;
        continue;
      }
      throw err; // other errors — propagate immediately
    }
  }

  // All Gemini combos exhausted
  const friendly = new Error('Hệ thống đang bận (tất cả Gemini key đã hết giới hạn). Vui lòng thử lại sau ít phút.');
  (friendly as any).isRateLimit = true;
  throw friendly;
}

// ── Groq fallback (OpenAI-compatible REST API — no SDK required) ──────────────
// Activates automatically when all Gemini (key × model) combos are exhausted.
// Set VITE_GROQ_API_KEY_1 / _2 / _3 in .env.local or Vercel environment vars.
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama3-70b-8192'];
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

type GroqMsg = { role: 'system' | 'user' | 'assistant'; content: string };

class GroqKeyManager {
  readonly keys: string[];
  private cooldowns = new Map<string, number>();

  constructor() {
    const e = import.meta.env;
    this.keys = [e.VITE_GROQ_API_KEY_1, e.VITE_GROQ_API_KEY_2, e.VITE_GROQ_API_KEY_3]
      .filter(Boolean) as string[];
    if (this.keys.length) console.log(`[GroqKeyManager] ${this.keys.length} key(s) loaded`);
  }

  get available(): boolean { return this.keys.length > 0; }

  isAvail(key: string, model: string): boolean {
    return Date.now() >= (this.cooldowns.get(`${key}::${model}`) ?? 0);
  }

  markRL(key: string, model: string): void {
    this.cooldowns.set(`${key}::${model}`, Date.now() + 65_000);
    console.warn(`[Groq] Key …${key.slice(-6)} + ${model} cooled 65s`);
  }

  getCombos(): Array<{ key: string; model: string }> {
    const all = GROQ_MODELS.flatMap(m => this.keys.map(k => ({ key: k, model: m })));
    return [...all.filter(c => this.isAvail(c.key, c.model)), ...all.filter(c => !this.isAvail(c.key, c.model))];
  }
}

let _groqKm: GroqKeyManager | null = null;
const getGroqKm = (): GroqKeyManager | null => {
  if (!_groqKm) _groqKm = new GroqKeyManager();
  return _groqKm.available ? _groqKm : null;
};

/** Non-streaming Groq call — returns full response text. */
async function groqComplete(messages: GroqMsg[]): Promise<string> {
  const km = getGroqKm();
  if (!km) throw Object.assign(new Error('Groq keys not configured'), { isConfigError: true });
  let lastErr: any;
  for (const { key, model } of km.getCombos()) {
    if (!km.isAvail(key, model)) continue;
    try {
      console.log(`[Groq] Calling ${model}...`);
      const resp = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 4096 }),
      });
      if (resp.status === 429) { km.markRL(key, model); lastErr = new Error('429'); await _sleep(300); continue; }
      if (!resp.ok) throw new Error(`Groq HTTP ${resp.status}: ${await resp.text()}`);
      return ((await resp.json()).choices[0].message.content) as string;
    } catch (err: any) {
      if (String(err?.message ?? '').includes('429')) { km.markRL(key, model); lastErr = err; continue; }
      throw err;
    }
  }
  throw lastErr ?? new Error('[Groq] All keys exhausted');
}

/** Streaming Groq call — calls onChunk for each token. */
async function groqStream(messages: GroqMsg[], onChunk: (t: string) => void): Promise<void> {
  const km = getGroqKm();
  if (!km) throw Object.assign(new Error('Groq keys not configured'), { isConfigError: true });
  let lastErr: any;
  for (const { key, model } of km.getCombos()) {
    if (!km.isAvail(key, model)) continue;
    try {
      console.log(`[Groq] Streaming ${model}...`);
      const resp = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 4096, stream: true }),
      });
      if (resp.status === 429) { km.markRL(key, model); lastErr = new Error('429'); await _sleep(300); continue; }
      if (!resp.ok) throw new Error(`Groq stream HTTP ${resp.status}`);
      const reader = resp.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') return;
          try { const t = JSON.parse(payload).choices?.[0]?.delta?.content; if (t) onChunk(t); } catch { /* ignore */ }
        }
      }
      return; // success
    } catch (err: any) {
      if (String(err?.message ?? '').includes('429')) { km.markRL(key, model); lastErr = err; continue; }
      throw err;
    }
  }
  const ex = new Error('Hệ thống tạm thời quá tải (Gemini + Groq đều hết quota). Vui lòng thử lại sau vài giờ.');
  (ex as any).isRateLimit = true;
  throw ex;
}

export const sendMessageStream = async (
  history: Message[],
  message: string,
  onChunk: (text: string) => void,
  patientInfo?: PatientInfo | null
) => {
  // Hoist systemInstruction so Groq fallback in catch can reuse it
  let systemInstruction = SYSTEM_INSTRUCTION;
  if (patientInfo) {
    const caseInfo = `
Thông tin bệnh nhân:
- Tên: ${patientInfo.name}
- Tuổi: ${patientInfo.age} ${patientInfo.ageUnit === 'years' ? 'tuổi' : patientInfo.ageUnit === 'months' ? 'tháng' : 'ngày'}
- Giới: ${patientInfo.gender === 'male' ? 'Nam' : 'Nữ'}
- Lý do khám: ${patientInfo.chiefComplaint}
- Hệ cơ quan: ${CLINICAL_SYSTEMS.find(s => s.value === patientInfo.clinicalSystem)?.label}
- Mức độ phức tạp: ${DIFFICULTY_LEVELS.find(d => d.value === patientInfo.difficulty)?.label}
`;
    systemInstruction = VIRTUAL_PATIENT_INSTRUCTION.replace('{CASE_INFO}', caseInfo);
  }

  try {
    console.log('sendMessageStream called with:', { historyLength: history.length, message, hasPatientInfo: !!patientInfo });

    // Retry only the initial stream setup (not the for-await loop)
    // to avoid calling onChunk twice if a 429 arrives mid-stream
    const result = await withRetry(async (client, modelName) => {
      const genModel = client.getGenerativeModel({ model: modelName, systemInstruction });

      let chatHistory = history
        .filter(m => !m.isError && m.content.trim() !== '')
        .map(m => ({
          role: m.role === 'user' ? 'user' : 'model' as const,
          parts: [{ text: m.content }]
        }));

      if (chatHistory.length > 0 && chatHistory[0].role === 'model') {
        chatHistory = chatHistory.slice(1);
      }

      const chat = genModel.startChat({ history: chatHistory });
      return chat.sendMessageStream(message);
    });

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) onChunk(text);
    }
  } catch (error: any) {
    // ── Groq streaming fallback ──────────────────────────────────────
    if ((error?.isRateLimit || error?.isConfigError) && getGroqKm()) {
      console.log('[Groq] Gemini exhausted — falling back to Groq for stream...');
      const validHist = history.filter(m => !m.isError && m.content.trim() !== '');
      const groqMsgs: GroqMsg[] = [
        { role: 'system', content: systemInstruction },
        ...validHist.map(m => ({ role: (m.role === 'user' ? 'user' : 'assistant') as GroqMsg['role'], content: m.content })),
        { role: 'user', content: message },
      ];
      await groqStream(groqMsgs, onChunk);
      return;
    }
    console.error("Error in stream:", error?.message, error?.status);
    throw error;
  }
};

// ============ Case Generation ============

interface GeneratedCase {
  patientInfo: PatientInfo;
  openingMessage: string;
}

const getRandomElement = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ============ Disease-Based Case Generation (RAG-enhanced) ============

const generateDiseaseBasedCase = async (config: CaseConfig): Promise<GeneratedCase> => {
  // First try to find in COMMON_DISEASES for extra info (sections, source)
  const disease = COMMON_DISEASES.find(d => d.id === config.diseaseId);
  
  // Use disease info from COMMON_DISEASES if available, otherwise use config
  const diseaseName = disease?.name || config.diseaseName || 'Bệnh không xác định';
  const diseaseSource = disease?.source || 'Cơ sở dữ liệu y khoa';
  const diseaseSections = disease?.sections || [];
  const diseaseCategory = disease?.category || 'pediatrics';

  const gender = Math.random() > 0.5 ? 'male' : 'female';
  const name = getRandomElement(vietnameseNames[gender]);
  const difficulty = config.difficulty || 'medium';
  const difficultyLabel = DIFFICULTY_LEVELS.find(d => d.value === difficulty)?.label || 'Trung bình';

  // Generate appropriate age based on disease category
  let age: number;
  let ageUnit: 'days' | 'months' | 'years';
  
  if (diseaseCategory === 'pediatrics') {
    // Pediatric cases - varied ages
    const ageChoice = Math.random();
    if (ageChoice < 0.2) {
      age = Math.floor(Math.random() * 11) + 1;
      ageUnit = 'months';
    } else if (ageChoice < 0.5) {
      age = Math.floor(Math.random() * 4) + 1;
      ageUnit = 'years';
    } else {
      age = Math.floor(Math.random() * 10) + 5;
      ageUnit = 'years';
    }
  } else {
    // Procedures/Treatment - mostly older children
    age = Math.floor(Math.random() * 12) + 3;
    ageUnit = 'years';
  }

  const prompt = `Bạn là hệ thống tạo ca bệnh nhi khoa dựa trên kiến thức y khoa chuẩn.

BỆNH LÝ TỪ CƠ SỞ DỮ LIỆU:
- Tên: ${diseaseName}
- Nguồn: ${diseaseSource}
${diseaseSections.length > 0 ? `- Các mục: ${diseaseSections.join(', ')}` : ''}

THÔNG TIN BỆNH NHÂN:
- Tên: ${name}
- Tuổi: ${age} ${ageUnit === 'years' ? 'tuổi' : ageUnit === 'months' ? 'tháng' : 'ngày'}
- Giới: ${gender === 'male' ? 'Nam' : 'Nữ'}
- Mức độ khó: ${difficultyLabel}

Hãy tạo một ca bệnh thực tế dựa trên bệnh lý trên. Trả về JSON với format sau (chỉ trả về JSON, không có text khác):
{
  "chiefComplaint": "Lý do đến khám ngắn gọn (1-2 câu) phù hợp với bệnh lý ${diseaseName}",
  "openingMessage": "Lời chào và mô tả triệu chứng ban đầu từ góc nhìn phụ huynh/bệnh nhân (2-3 câu, tự nhiên như đang nói chuyện)",
  "clinicalSystem": "hệ cơ quan phù hợp: respiratory/cardiovascular/gastrointestinal/neurological/infectious/endocrine/renal/hematological"
}`;

  try {
    const result = await withRetry(async (client, modelName) => {
      console.log('Generating disease-based case with Gemini...', diseaseName, 'model:', modelName);
      return client.getGenerativeModel({ model: modelName }).generateContent(prompt);
    });
    const text = result.response.text();
    console.log('Generated text:', text);
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid response format');
    }

    const caseData = JSON.parse(jsonMatch[0]);
    const caseId = config.diseaseId || `RAG-${Date.now().toString(36).toUpperCase()}`;

    const patientInfo: PatientInfo = {
      caseId: `${caseId}-${Date.now().toString(36).toUpperCase()}`,
      name,
      age,
      ageUnit,
      gender,
      chiefComplaint: caseData.chiefComplaint,
      clinicalSystem: (caseData.clinicalSystem as ClinicalSystem) || 'respiratory',
      difficulty: difficulty,
      caseType: config.caseType,
    };

    return {
      patientInfo,
      openingMessage: caseData.openingMessage,
    };
  } catch (error) {
    console.error('Disease-based case generation error:', error);
    // Try Groq before final hardcoded fallback
    if (((error as any)?.isRateLimit || (error as any)?.isConfigError) && getGroqKm()) {
      try {
        const groqText = await groqComplete([{ role: 'user', content: prompt }]);
        const jMatch = groqText.match(/\{[\s\S]*\}/);
        if (jMatch) {
          const cd = JSON.parse(jMatch[0]);
          const cId = config.diseaseId || `RAG-${Date.now().toString(36).toUpperCase()}`;
          return {
            patientInfo: {
              caseId: `${cId}-${Date.now().toString(36).toUpperCase()}`,
              name, age, ageUnit, gender,
              chiefComplaint: cd.chiefComplaint,
              clinicalSystem: (cd.clinicalSystem as ClinicalSystem) || 'respiratory',
              difficulty,
              caseType: config.caseType,
            },
            openingMessage: cd.openingMessage,
          };
        }
      } catch (groqErr) { console.error('[Groq] Disease-case fallback failed:', groqErr); }
    }
    const caseId = config.diseaseId || `RAG-${Date.now().toString(36).toUpperCase()}`;
    // Hardcoded fallback
    const patientInfo: PatientInfo = {
      caseId: `${caseId}-${Date.now().toString(36).toUpperCase()}`,
      name,
      age,
      ageUnit,
      gender,
      chiefComplaint: `Liên quan đến ${diseaseName}`,
      clinicalSystem: 'respiratory',
      difficulty: difficulty,
      caseType: config.caseType,
    };

    return {
      patientInfo,
      openingMessage: `Chào bác sĩ, con ${name} của tôi có vấn đề sức khỏe. Tôi rất lo lắng và muốn bác sĩ khám cho cháu.`,
    };
  }
};

const generateRandomConfig = (): { system: ClinicalSystem; difficulty: DifficultyLevel; ageGroup: AgeGroup } => {
  const systems: ClinicalSystem[] = ['respiratory', 'gastrointestinal', 'infectious', 'neurological'];
  const difficulties: DifficultyLevel[] = ['easy', 'medium', 'hard'];
  const ageGroups: AgeGroup[] = ['infant', 'toddler', 'preschool', 'school-age', 'adolescent'];
  
  return {
    system: getRandomElement(systems),
    difficulty: getRandomElement(difficulties),
    ageGroup: getRandomElement(ageGroups),
  };
};

const getAgeFromGroup = (ageGroup: AgeGroup): { age: number; ageUnit: 'days' | 'months' | 'years' } => {
  switch (ageGroup) {
    case 'neonatal':
      return { age: Math.floor(Math.random() * 28) + 1, ageUnit: 'days' };
    case 'infant':
      return { age: Math.floor(Math.random() * 11) + 1, ageUnit: 'months' };
    case 'toddler':
      return { age: Math.floor(Math.random() * 2) + 1, ageUnit: 'years' };
    case 'preschool':
      return { age: Math.floor(Math.random() * 2) + 3, ageUnit: 'years' };
    case 'school-age':
      return { age: Math.floor(Math.random() * 6) + 6, ageUnit: 'years' };
    case 'adolescent':
      return { age: Math.floor(Math.random() * 5) + 13, ageUnit: 'years' };
    default:
      return { age: Math.floor(Math.random() * 10) + 2, ageUnit: 'years' };
  }
};

const vietnameseNames = {
  male: ['Minh', 'Hùng', 'Dũng', 'Tuấn', 'Nam', 'Quang', 'Đức', 'Phong', 'Bảo', 'Khang'],
  female: ['Linh', 'Hương', 'Ngọc', 'Mai', 'Lan', 'Hà', 'Thu', 'Hạnh', 'Vy', 'Trang']
};

export const generateCase = async (config: CaseConfig): Promise<GeneratedCase> => {
  // Check if this is a disease-based case from RAG database
  if (config.diseaseId && config.diseaseName) {
    return generateDiseaseBasedCase(config);
  }
  
  // Determine case parameters
  let clinicalSystem = config.clinicalSystem;
  let difficulty = config.difficulty;
  let ageGroup = config.ageGroup;

  if (config.caseType === 'random') {
    const randomConfig = generateRandomConfig();
    clinicalSystem = clinicalSystem || randomConfig.system;
    difficulty = difficulty || randomConfig.difficulty;
    ageGroup = ageGroup || randomConfig.ageGroup;
  }

  // Defaults
  clinicalSystem = clinicalSystem || 'respiratory';
  difficulty = difficulty || 'medium';
  ageGroup = ageGroup || 'school-age';

  const gender = Math.random() > 0.5 ? 'male' : 'female';
  const name = getRandomElement(vietnameseNames[gender]);
  const { age, ageUnit } = getAgeFromGroup(ageGroup);

  const systemLabel = CLINICAL_SYSTEMS.find(s => s.value === clinicalSystem)?.label || 'Hô hấp';
  const difficultyLabel = DIFFICULTY_LEVELS.find(d => d.value === difficulty)?.label || 'Trung bình';

  // Generate case details using AI
  const prompt = `Bạn là hệ thống tạo ca bệnh nhi khoa để huấn luyện sinh viên y.

Hãy tạo một ca bệnh với các thông số sau:
- Hệ cơ quan: ${systemLabel}
- Mức độ khó: ${difficultyLabel}
- Tuổi: ${age} ${ageUnit === 'years' ? 'tuổi' : ageUnit === 'months' ? 'tháng' : 'ngày'}
- Giới: ${gender === 'male' ? 'Nam' : 'Nữ'}
- Tên: ${name}

Trả về JSON với format sau (chỉ trả về JSON, không có text khác):
{
  "chiefComplaint": "Lý do đến khám ngắn gọn (1-2 câu)",
  "openingMessage": "Lời chào và mô tả triệu chứng ban đầu từ góc nhìn phụ huynh/bệnh nhân (2-3 câu, tự nhiên như đang nói chuyện)"
}`;

  try {
    const result = await withRetry(async (client, modelName) => {
      console.log('Generating case with Gemini... model:', modelName);
      return client.getGenerativeModel({ model: modelName }).generateContent(prompt);
    });
    const text = result.response.text();
    console.log('Generated text:', text);
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid response format');
    }

    const caseData = JSON.parse(jsonMatch[0]);

    const patientInfo: PatientInfo = {
      caseId: `CASE-${Date.now().toString(36).toUpperCase()}`,
      name,
      age,
      ageUnit,
      gender,
      chiefComplaint: caseData.chiefComplaint,
      clinicalSystem: clinicalSystem!,
      difficulty: difficulty!,
      caseType: config.caseType,
    };

    return {
      patientInfo,
      openingMessage: caseData.openingMessage,
    };
  } catch (error) {
    console.error('Case generation error:', error);
    // Try Groq before final hardcoded fallback
    if (((error as any)?.isRateLimit || (error as any)?.isConfigError) && getGroqKm()) {
      try {
        const groqText = await groqComplete([{ role: 'user', content: prompt }]);
        const jMatch = groqText.match(/\{[\s\S]*\}/);
        if (jMatch) {
          const cd = JSON.parse(jMatch[0]);
          return {
            patientInfo: {
              caseId: `CASE-${Date.now().toString(36).toUpperCase()}`,
              name, age, ageUnit, gender,
              chiefComplaint: cd.chiefComplaint,
              clinicalSystem: clinicalSystem!,
              difficulty: difficulty!,
              caseType: config.caseType,
            },
            openingMessage: cd.openingMessage,
          };
        }
      } catch (groqErr) { console.error('[Groq] Case fallback failed:', groqErr); }
    }
    // Hardcoded fallback
    const patientInfo: PatientInfo = {
      caseId: `CASE-${Date.now().toString(36).toUpperCase()}`,
      name,
      age,
      ageUnit,
      gender,
      chiefComplaint: 'Sốt và ho 3 ngày',
      clinicalSystem: clinicalSystem!,
      difficulty: difficulty!,
      caseType: config.caseType,
    };

    return {
      patientInfo,
      openingMessage: `Chào bác sĩ, con ${name} của tôi bị sốt và ho được 3 ngày rồi. Tôi rất lo lắng vì cháu không chịu ăn uống gì cả.`,
    };
  }
};

// ============ Session Evaluation ============

export const evaluateSession = async (
  session: TrainingSession,
  diagnosis: DiagnosisSubmission
): Promise<EvaluationResult> => {
  const conversationText = session.messages
    .map(m => `${m.role === 'user' ? 'Sinh viên' : 'Bệnh nhân'}: ${m.content}`)
    .join('\n');

  const patientInfo = session.patientInfo;
  const systemLabel = CLINICAL_SYSTEMS.find(s => s.value === patientInfo?.clinicalSystem)?.label;
  const difficultyLabel = DIFFICULTY_LEVELS.find(d => d.value === patientInfo?.difficulty)?.label;

  const prompt = `${EVALUATOR_INSTRUCTION}

=== THÔNG TIN CA BỆNH ===
- Mã ca: ${patientInfo?.caseId}
- Bệnh nhân: ${patientInfo?.name}, ${patientInfo?.age} ${patientInfo?.ageUnit === 'years' ? 'tuổi' : patientInfo?.ageUnit === 'months' ? 'tháng' : 'ngày'}, ${patientInfo?.gender === 'male' ? 'Nam' : 'Nữ'}
- Lý do khám: ${patientInfo?.chiefComplaint}
- Hệ cơ quan: ${systemLabel}
- Mức độ phức tạp: ${difficultyLabel}

=== CUỘC HỘI THOẠI ===
${conversationText}

=== CHẨN ĐOÁN CỦA SINH VIÊN ===
- Chẩn đoán sơ bộ: ${diagnosis.provisionalDiagnosis}
- Chẩn đoán phân biệt: ${diagnosis.differentialDiagnoses.join(', ') || 'Không có'}
- Kế hoạch xử trí: ${diagnosis.managementPlan}

Hãy đánh giá và trả về JSON với format sau (chỉ trả về JSON):
{
  "overallScore": <số từ 0-100>,
  "subScores": {
    "historyTaking": <số từ 0-25>,
    "physicalExamination": <số từ 0-25>,
    "diagnosis": <số từ 0-25>,
    "managementPlan": <số từ 0-25>
  },
  "strengths": ["<điểm mạnh 1>", "<điểm mạnh 2>"],
  "weaknesses": ["<điểm yếu 1>", "<điểm yếu 2>"],
  "suggestions": ["<gợi ý cải thiện 1>", "<gợi ý cải thiện 2>"],
  "detailedFeedback": "<nhận xét chi tiết 3-5 câu>"
}`;

  try {
    const result = await withRetry(async (client, modelName) => {
      console.log('Evaluating session with Gemini... model:', modelName);
      return client.getGenerativeModel({ model: modelName }).generateContent(prompt);
    });
    const text = result.response.text();
    console.log('Evaluation response:', text);
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid response format');
    }

    const evalData = JSON.parse(jsonMatch[0]);
    
    return {
      overallScore: evalData.overallScore || 0,
      maxScore: 100,
      subScores: {
        historyTaking: evalData.subScores?.historyTaking || 0,
        physicalExamination: evalData.subScores?.physicalExamination || 0,
        diagnosis: evalData.subScores?.diagnosis || 0,
        managementPlan: evalData.subScores?.managementPlan || 0,
      },
      strengths: evalData.strengths || [],
      weaknesses: evalData.weaknesses || [],
      suggestions: evalData.suggestions || [],
      detailedFeedback: evalData.detailedFeedback || '',
      evaluatedAt: Date.now(),
    };
  } catch (error) {
    console.error('Evaluation error:', error);
    // Try Groq before hardcoded fallback
    if (((error as any)?.isRateLimit || (error as any)?.isConfigError) && getGroqKm()) {
      try {
        const groqText = await groqComplete([{ role: 'user', content: prompt }]);
        const jMatch = groqText.match(/\{[\s\S]*\}/);
        if (jMatch) {
          const evalData = JSON.parse(jMatch[0]);
          return {
            overallScore: evalData.overallScore || 0,
            maxScore: 100,
            subScores: {
              historyTaking: evalData.subScores?.historyTaking || 0,
              physicalExamination: evalData.subScores?.physicalExamination || 0,
              diagnosis: evalData.subScores?.diagnosis || 0,
              managementPlan: evalData.subScores?.managementPlan || 0,
            },
            strengths: evalData.strengths || [],
            weaknesses: evalData.weaknesses || [],
            suggestions: evalData.suggestions || [],
            detailedFeedback: evalData.detailedFeedback || '',
            evaluatedAt: Date.now(),
          };
        }
      } catch (groqErr) { console.error('[Groq] Evaluation fallback failed:', groqErr); }
    }
    // Hardcoded fallback evaluation
    return {
      overallScore: 50,
      maxScore: 100,
      subScores: {
        historyTaking: 15,
        physicalExamination: 10,
        diagnosis: 15,
        managementPlan: 10,
      },
      strengths: ['Có nỗ lực hoàn thành bài tập'],
      weaknesses: ['Không thể đánh giá chi tiết do lỗi hệ thống'],
      suggestions: ['Vui lòng thử lại sau'],
      detailedFeedback: 'Đánh giá tự động gặp sự cố. Đây là điểm mặc định.',
      evaluatedAt: Date.now(),
    };
  }
};
