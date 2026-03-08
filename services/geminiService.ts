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
  'gemini-1.5-flash-8b',
  'gemini-1.5-flash',
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
      const err = new Error('Chưa cấu hình VITE_GEMINI_API_KEY. Vui lòng liên hệ quản trị viên.');
      (err as any).isConfigError = true;
      throw err;
    }
    console.log(`[GeminiKeyManager] ${this.keys.length} key(s) loaded`);
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

// Lazily initialized — avoids crash at module load when env vars are missing on first deploy
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
 */
async function withRetry<T>(fn: (client: GoogleGenerativeAI, model: string) => Promise<T>): Promise<T> {
  const km = getKm();
  const combos = km.getCombos();
  let lastErr: any;

  for (const { key, model } of combos) {
    if (!km.isAvailable(key, model)) continue; // skip still-cooled combos
    try {
      return await fn(km.getClient(key), model);
    } catch (err: any) {
      if (_isRateLimit(err)) {
        km.markRateLimited(key, model, _isDailyQuota(err));
        lastErr = err;
        await _sleep(300); // tiny pause before trying next combo
        continue;
      }
      throw err; // non-rate-limit error — propagate immediately
    }
  }

  // All combos exhausted
  const friendly = new Error('Hệ thống đang bận (tất cả key đã hết giới hạn). Vui lòng thử lại sau ít phút.');
  (friendly as any).isRateLimit = true;
  throw friendly;
}

export const sendMessageStream = async (
  history: Message[],
  message: string,
  onChunk: (text: string) => void,
  patientInfo?: PatientInfo | null
) => {
  try {
    console.log('sendMessageStream called with:', { historyLength: history.length, message, hasPatientInfo: !!patientInfo });
    
    // Build system instruction based on context
    let systemInstruction = SYSTEM_INSTRUCTION;
    
    if (patientInfo) {
      // Virtual patient mode
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
    const caseId = config.diseaseId || `RAG-${Date.now().toString(36).toUpperCase()}`;
    // Fallback case
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
    // Fallback case
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
    // Fallback evaluation
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
