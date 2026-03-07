export interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  isError?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}

export interface UserSettings {
  theme: 'light' | 'dark'; // Placeholder for future
}

// ============ Training Session Types ============

export type CaseType = 'random' | 'customised';
export type SessionStatus = 'in-progress' | 'pending-evaluation' | 'completed';
export type ClinicalSystem = 'respiratory' | 'cardiovascular' | 'gastrointestinal' | 'neurological' | 'infectious' | 'endocrine' | 'renal' | 'hematological';
export type DifficultyLevel = 'easy' | 'medium' | 'hard';
export type AgeGroup = 'neonatal' | 'infant' | 'toddler' | 'preschool' | 'school-age' | 'adolescent';

export interface CaseConfig {
  caseType: CaseType;
  ageGroup?: AgeGroup;
  ageRange?: { min: number; max: number };
  clinicalSystem?: ClinicalSystem;
  difficulty?: DifficultyLevel;
  practiceMode?: boolean;
  // RAG-based case selection
  diseaseId?: string;
  diseaseName?: string;
}

export interface PatientInfo {
  caseId: string;
  name: string;
  age: number;
  ageUnit: 'days' | 'months' | 'years';
  gender: 'male' | 'female';
  chiefComplaint: string;
  clinicalSystem: ClinicalSystem;
  difficulty: DifficultyLevel;
  caseType: CaseType;
}

export interface DiagnosisSubmission {
  provisionalDiagnosis: string;
  differentialDiagnoses: string[];
  managementPlan: string;
  submittedAt: number;
}

// RAG Diagnosis Submission (detailed format for RAG evaluation)
export interface RAGDiagnosisSubmission {
  clinical: string;              // Lâm sàng
  paraclinical: string;          // Cận lâm sàng
  definitiveDiagnosis: string;   // Chẩn đoán xác định
  differentialDiagnosis: string; // Chẩn đoán phân biệt
  treatment: string;             // Cách điều trị
  medication: string;            // Thuốc
  submittedAt: number;
}

// Form data before the timestamp is added (what the diagnosis form emits)
export type RAGDiagnosisData = Omit<RAGDiagnosisSubmission, 'submittedAt'>;

export interface EvaluationResult {
  overallScore: number;
  maxScore: number;
  subScores: {
    historyTaking: number;
    physicalExamination: number;
    diagnosis: number;
    managementPlan: number;
  };
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  detailedFeedback: string;
  evaluatedAt: number;
}

// RAG Evaluation Result (from RAG system)
export interface RAGEvaluationResult {
  diem_manh: string[];
  diem_yeu: string[];
  da_co: string[];
  thieu: string[];
  dien_giai: string;
  diem_so: string;
  nhan_xet_tong_quan: string;
  standardAnswer?: string;
  sources?: {
    file: string;
    title: string;
    section: string;
    content?: string;
  }[];
}

export interface TrainingSession {
  id: string;
  caseConfig: CaseConfig;
  patientInfo: PatientInfo | null;
  messages: Message[];
  diagnosis: DiagnosisSubmission | null;
  ragDiagnosis: RAGDiagnosisSubmission | null; // For RAG-based cases
  evaluation: EvaluationResult | null;
  ragEvaluation: RAGEvaluationResult | null; // For RAG-based evaluations
  status: SessionStatus;
  interactionCount: number;
  createdAt: number;
  updatedAt: number;
  isRAGMode?: boolean; // Flag to indicate if this is a RAG-based session
  ragSessionId?: string; // Session ID for RAG backend
}

export type AppView = 'home' | 'case-selection' | 'consultation' | 'diagnosis' | 'feedback' | 'history' | 'knowledge';

// ============ RAG Knowledge Base Types ============

export type DiseaseCategory = 
  | 'procedures'      // Thủ thuật y tế (BoYTe200)
  | 'pediatrics'      // Nhi khoa (NHIKHOA2)  
  | 'treatment'       // Phác đồ điều trị (PHACDODIEUTRI)
  | 'all';

export interface DiseaseInfo {
  id: string;
  name: string;           // Tên bệnh/thủ thuật (Index)
  category: DiseaseCategory;
  sections: string[];     // level1_items - các mục chính
  source: string;         // File nguồn
}

export interface KnowledgeQuery {
  query: string;
  category?: DiseaseCategory;
  diseaseId?: string;
}

export interface KnowledgeResult {
  answer: string;
  sources: {
    file: string;
    title: string;
    section: string;
    content: string;
  }[];
}
