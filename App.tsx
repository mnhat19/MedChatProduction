import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Message, TrainingSession, CaseConfig, DiagnosisSubmission, RAGDiagnosisSubmission, RAGDiagnosisData, RAGEvaluationResult } from './types';
import { MIN_INTERACTION_TURNS, CLINICAL_SYSTEMS, DIFFICULTY_LEVELS, DISEASE_CATEGORIES, COMMON_DISEASES } from './constants';
import { sendMessageStream, generateCase, evaluateSession } from './services/geminiService';
import { ragService, Disease } from './services/ragService';
import Sidebar from './components/Sidebar';
import MessageBubble from './components/MessageBubble';
import InputArea from './components/InputArea';
import CaseTypeModal from './components/CaseTypeModal';
import DiagnosisForm from './components/DiagnosisForm';
import RAGDiagnosisForm from './components/RAGDiagnosisForm';
import DiseaseSelectorModal from './components/DiseaseSelectorModal';
import FeedbackPanel from './components/FeedbackPanel';
import { MenuIcon, HeartPulseIcon, ChildIcon, PlayIcon, HistoryIcon, DocumentTextIcon, DatabaseIcon } from './components/Icons';

const App: React.FC = () => {
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Modal states
  const [showCaseModal, setShowCaseModal] = useState(false);
  const [showDiseaseSelector, setShowDiseaseSelector] = useState(false);
  const [showDiagnosisForm, setShowDiagnosisForm] = useState(false);
  const [showRAGDiagnosisForm, setShowRAGDiagnosisForm] = useState(false);
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);

  // Load from local storage on mount
  useEffect(() => {
    const saved = localStorage.getItem('pediatric_training_sessions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSessions(parsed);
      } catch (e) {
        console.error("Failed to load sessions", e);
      }
    }
  }, []);

  // Save to local storage whenever sessions change
  useEffect(() => {
    try {
      // Keep only the 50 most recent sessions to prevent quota overflow
      const toSave = sessions.slice(0, 50);
      localStorage.setItem('pediatric_training_sessions', JSON.stringify(toSave));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        // Prune oldest half and retry
        try {
          const pruned = sessions.slice(0, Math.floor(sessions.length / 2));
          localStorage.setItem('pediatric_training_sessions', JSON.stringify(pruned));
          setSessions(pruned);
          console.warn('[Storage] Quota exceeded — pruned old sessions');
        } catch {
          console.error('[Storage] Unable to save sessions even after pruning');
        }
      } else {
        console.error('[Storage] Failed to save sessions:', e);
      }
    }
  }, [sessions]);

  const currentSession = sessions.find(s => s.id === currentSessionId);
  const messages = currentSession?.messages || [];
  const interactionCount = messages.filter(m => m.role === 'user').length;

  // Scroll to bottom ref
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Start a new case
  const handleStartCase = useCallback(async (config: CaseConfig) => {
    setShowCaseModal(false);
    
    // Check if this is a RAG-based case (has diseaseId flag)
    if (config.diseaseId === '__TRIGGER_DISEASE_SELECTOR__') {
      // Open disease selector modal
      setShowDiseaseSelector(true);
      return;
    }
    
    if (config.diseaseId && config.diseaseName) {
      // Disease already selected (shouldn't happen with new flow, but keep for safety)
      setShowDiseaseSelector(true);
      return;
    }
    
    // Regular AI mode
    setIsLoading(true);

    const newSession: TrainingSession = {
      id: Date.now().toString(),
      caseConfig: config,
      patientInfo: null,
      messages: [],
      diagnosis: null,
      ragDiagnosis: null,
      evaluation: null,
      ragEvaluation: null,
      status: 'in-progress',
      interactionCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isRAGMode: false,
    };

    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);

    try {
      // Generate case from AI
      const { patientInfo, openingMessage } = await generateCase(config);
      
      const initialMessage: Message = {
        id: Date.now().toString(),
        role: 'model',
        content: openingMessage,
        timestamp: Date.now(),
      };

      setSessions(prev => prev.map(s => 
        s.id === newSession.id 
          ? { ...s, patientInfo, messages: [initialMessage], updatedAt: Date.now() }
          : s
      ));
    } catch (error) {
      console.error('Failed to generate case:', error);
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'model',
        content: 'Xin lỗi, không thể tạo ca bệnh lúc này. Vui lòng thử lại sau.',
        timestamp: Date.now(),
        isError: true,
      };
      setSessions(prev => prev.map(s => 
        s.id === newSession.id 
          ? { ...s, messages: [errorMessage] }
          : s
      ));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Handler for RAG disease selection
  const handleSelectRAGDisease = async (disease: Disease) => {
    console.log('[RAG] Selected disease:', disease);
    setShowDiseaseSelector(false);
    setIsLoading(true);

    const sessionId = Date.now().toString();
    const ragBackendSessionId = `rag_${sessionId}`;

    const newSession: TrainingSession = {
      id: sessionId,
      caseConfig: {
        caseType: 'customised',
        diseaseId: disease.id,
        diseaseName: disease.name,
      },
      patientInfo: null,
      messages: [],
      diagnosis: null,
      ragDiagnosis: null,
      evaluation: null,
      ragEvaluation: null,
      status: 'in-progress',
      interactionCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isRAGMode: true,
      ragSessionId: ragBackendSessionId,
    };

    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(sessionId);

    try {
      console.log('[RAG] Calling generateCase for:', disease.name);
      // Call RAG API to generate case
      const result = await ragService.generateCase(disease.name, ragBackendSessionId);
      console.log('[RAG] generateCase result:', result);
      
      const initialMessage: Message = {
        id: Date.now().toString(),
        role: 'model',
        content: result.case,
        timestamp: Date.now(),
      };

      // Create a simple patient info from disease
      const patientInfo = {
        caseId: sessionId,
        name: 'Bệnh nhân',
        age: 5,
        ageUnit: 'years' as const,
        gender: 'male' as const,
        chiefComplaint: disease.name,
        clinicalSystem: 'infectious' as const,  // RAG mode — actual system comes from the disease
        difficulty: 'medium' as const,
        caseType: 'customised' as const,
      };

      setSessions(prev => prev.map(s => 
        s.id === sessionId 
          ? { ...s, patientInfo, messages: [initialMessage], updatedAt: Date.now() }
          : s
      ));
    } catch (error) {
      console.error('[RAG] Failed to generate RAG case:', error);
      console.error('[RAG] Error details:', JSON.stringify(error, null, 2));
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'model',
        content: `Xin lỗi, không thể tạo ca bệnh từ CSDL. Lỗi: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: Date.now(),
        isError: true,
      };
      setSessions(prev => prev.map(s => 
        s.id === sessionId 
          ? { ...s, messages: [errorMessage] }
          : s
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) {
      setCurrentSessionId(null);
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!currentSessionId || !currentSession) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: Date.now()
    };

    setSessions(prev => prev.map(session => {
      if (session.id === currentSessionId) {
        return {
          ...session,
          messages: [...session.messages, userMsg],
          interactionCount: session.interactionCount + 1,
          updatedAt: Date.now()
        };
      }
      return session;
    }));

    setIsLoading(true);

    const botMsgId = (Date.now() + 1).toString();
    const botMsgPlaceholder: Message = {
      id: botMsgId,
      role: 'model',
      content: '',
      timestamp: Date.now()
    };

    setSessions(prev => prev.map(s => 
      s.id === currentSessionId 
        ? { ...s, messages: [...s.messages, botMsgPlaceholder] } 
        : s
    ));

    try {
      const historyMessages = currentSession.messages;
      
      await sendMessageStream(
        historyMessages, 
        text, 
        (chunkText) => {
          setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
              const updatedMessages = s.messages.map(m => {
                if (m.id === botMsgId) {
                  return { ...m, content: m.content + chunkText };
                }
                return m;
              });
              return { ...s, messages: updatedMessages };
            }
            return s;
          }));
        },
        currentSession.patientInfo // Pass patient context
      );
    } catch (error: any) {
      const errMsg = (error as any)?.isRateLimit
        ? "Hệ thống đang bận (rate limit). Vui lòng đợi vài giây rồi thử lại."
        : (error as any)?.isConfigError
        ? "Lỗi cấu hình: chưa thiết lập API key. Vui lòng liên hệ quản trị viên."
        : "Xin lỗi, có lỗi xảy ra. Vui lòng thử lại.";
      setSessions(prev => prev.map(s => {
        if (s.id === currentSessionId) {
          const updatedMessages = s.messages.map(m => {
            if (m.id === botMsgId) {
              return { ...m, isError: true, content: m.content || errMsg };
            }
            return m;
          });
          return { ...s, messages: updatedMessages };
        }
        return s;
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitDiagnosis = async (diagnosis: DiagnosisSubmission) => {
    if (!currentSession) return;

    // Check if RAG mode
    if (currentSession.isRAGMode) {
      // Use RAG diagnosis form instead
      setShowDiagnosisForm(false);
      setShowRAGDiagnosisForm(true);
      return;
    }

    setShowDiagnosisForm(false);
    setShowFeedbackPanel(true);
    setIsEvaluating(true);

    // Update session with diagnosis
    setSessions(prev => prev.map(s => 
      s.id === currentSessionId 
        ? { ...s, diagnosis, status: 'pending-evaluation', updatedAt: Date.now() }
        : s
    ));

    try {
      // Call AI evaluator
      const evaluation = await evaluateSession(currentSession, diagnosis);
      
      setSessions(prev => prev.map(s => 
        s.id === currentSessionId 
          ? { ...s, evaluation, status: 'completed', updatedAt: Date.now() }
          : s
      ));
    } catch (error) {
      console.error('Evaluation failed:', error);
      // Keep pending status, allow retry later
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleSubmitRAGDiagnosis = async (diagnosis: RAGDiagnosisData) => {
    if (!currentSession || !currentSession.isRAGMode || !currentSession.ragSessionId) return;

    setShowRAGDiagnosisForm(false);
    setShowFeedbackPanel(true);
    setIsEvaluating(true);

    const diagnosisWithTimestamp: RAGDiagnosisSubmission = {
      ...diagnosis,
      submittedAt: Date.now(),
    };

    // Update session with RAG diagnosis
    setSessions(prev => prev.map(s => 
      s.id === currentSessionId 
        ? { ...s, ragDiagnosis: diagnosisWithTimestamp, status: 'pending-evaluation', updatedAt: Date.now() }
        : s
    ));

    try {
      console.log('[App] Calling RAG evaluate API...');
      // Call RAG evaluator API
      const result = await ragService.evaluateAnswer(currentSession.ragSessionId, {
        clinical: diagnosis.clinical,
        paraclinical: diagnosis.paraclinical,
        definitiveDiagnosis: diagnosis.definitiveDiagnosis,
        differentialDiagnosis: diagnosis.differentialDiagnosis,
        treatment: diagnosis.treatment,
        medication: diagnosis.medication,
      });
      console.log('[App] RAG evaluate result:', result);

      // Parse evaluation result
      let evaluationObj: RAGEvaluationResult;
      try {
        evaluationObj = typeof result.evaluation === 'string' 
          ? JSON.parse(result.evaluation) 
          : result.evaluation;
        console.log('[App] Parsed evaluation obj:', evaluationObj);
      } catch (parseError) {
        console.error('[App] Failed to parse evaluation:', parseError);
        evaluationObj = {
          diem_manh: [],
          diem_yeu: ['Không thể parse JSON đánh giá'],
          da_co: [],
          thieu: [],
          dien_giai: result.evaluation,
          diem_so: 'N/A',
          nhan_xet_tong_quan: 'Lỗi parse',
        };
      }

      evaluationObj.standardAnswer = result.standard;
      evaluationObj.sources = result.sources;
      console.log('[App] Final evaluation object to save:', evaluationObj);
      
      setSessions(prev => prev.map(s => 
        s.id === currentSessionId 
          ? { ...s, ragEvaluation: evaluationObj, status: 'completed', updatedAt: Date.now() }
          : s
      ));
      console.log('[App] Evaluation saved to session');
    } catch (error) {
      console.error('RAG Evaluation failed:', error);
      // Create error evaluation
      const errorEval: RAGEvaluationResult = {
        diem_manh: [],
        diem_yeu: ['Không thể đánh giá do lỗi kết nối'],
        da_co: [],
        thieu: [],
        dien_giai: `Lỗi: ${error}`,
        diem_so: 'N/A',
        nhan_xet_tong_quan: 'Vui lòng thử lại sau',
      };
      setSessions(prev => prev.map(s => 
        s.id === currentSessionId 
          ? { ...s, ragEvaluation: errorEval, status: 'completed', updatedAt: Date.now() }
          : s
      ));
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleBackToHome = () => {
    setShowFeedbackPanel(false);
    setCurrentSessionId(null);
  };

  const handleViewHistory = () => {
    // Just open sidebar on mobile, sessions are already visible
    setSidebarOpen(true);
  };

  // Get labels for display
  const getSystemLabel = (system?: string) => 
    CLINICAL_SYSTEMS.find(s => s.value === system)?.label || '';
  const getDifficultyLabel = (diff?: string) => 
    DIFFICULTY_LEVELS.find(d => d.value === diff)?.label || '';

  return (
    <div className="flex h-full w-full bg-[#f8fafc] overflow-hidden">
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={(id) => {
          setCurrentSessionId(id);
          const session = sessions.find(s => s.id === id);
          if (session?.status === 'completed' && session.evaluation) {
            setShowFeedbackPanel(true);
          }
        }}
        onNewSession={() => setShowCaseModal(true)}
        onDeleteSession={deleteSession}
        onGoHome={() => setCurrentSessionId(null)}
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
      />

      <div className="flex-1 flex flex-col h-full relative w-full">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 border-b border-gray-200 bg-white shadow-sm z-10">
          <div className="flex items-center">
             <button onClick={() => setSidebarOpen(true)} className="p-2 -ml-2 text-brand-700 hover:bg-gray-100 rounded-lg">
                <MenuIcon />
             </button>
             <span className="font-semibold text-brand-900 ml-2 cursor-pointer" onClick={() => setCurrentSessionId(null)}>Mocha</span>
          </div>
          <HeartPulseIcon className="w-6 h-6 text-primary-600" />
        </div>

        {/* Case Header (when in consultation) */}
        {currentSession && currentSession.patientInfo && (
          <div className="bg-white border-b border-gray-200 px-4 py-3 shadow-sm">
            <div className="max-w-3xl mx-auto flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
                  <ChildIcon className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">
                      {currentSession.patientInfo.name}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      currentSession.caseConfig.diseaseId 
                        ? 'bg-green-100 text-green-700'
                        : currentSession.caseConfig.caseType === 'random' 
                        ? 'bg-blue-100 text-blue-700' 
                        : 'bg-purple-100 text-purple-700'
                    }`}>
                      {currentSession.caseConfig.diseaseId 
                        ? 'CSDL Y khoa' 
                        : currentSession.caseConfig.caseType === 'random' 
                        ? 'Ngẫu nhiên' 
                        : 'Tùy chỉnh'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <span>{currentSession.patientInfo.age} {currentSession.patientInfo.ageUnit === 'years' ? 'tuổi' : currentSession.patientInfo.ageUnit === 'months' ? 'tháng' : 'ngày'}</span>
                    <span>•</span>
                    <span>{currentSession.patientInfo.gender === 'male' ? 'Nam' : 'Nữ'}</span>
                    <span>•</span>
                    <span>{currentSession.caseConfig.diseaseName || getSystemLabel(currentSession.patientInfo.clinicalSystem)}</span>
                    <span>•</span>
                    <span className={`font-medium ${
                      currentSession.patientInfo.difficulty === 'easy' ? 'text-green-600' :
                      currentSession.patientInfo.difficulty === 'medium' ? 'text-amber-600' : 'text-red-600'
                    }`}>
                      {getDifficultyLabel(currentSession.patientInfo.difficulty)}
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Proceed to Diagnosis button */}
              {currentSession.status === 'in-progress' && (
                <button
                  onClick={() => {
                    if (currentSession.isRAGMode) {
                      setShowRAGDiagnosisForm(true);
                    } else {
                      setShowDiagnosisForm(true);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors text-sm"
                >
                  <DocumentTextIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">Tiến hành chẩn đoán</span>
                  <span className="sm:hidden">Chẩn đoán</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto scroll-smooth">
          <div className="max-w-3xl mx-auto h-full w-full">
            {!currentSession ? (
                // Welcome Screen / Home
                <div className="h-full flex flex-col items-center justify-center p-6 text-center overflow-y-auto">
                    <div className="w-24 h-24 bg-gradient-to-br from-primary-500 to-blue-600 rounded-3xl shadow-2xl flex items-center justify-center mb-8 rotate-3">
                        <ChildIcon className="w-12 h-12 text-white" />
                    </div>
                    
                    <h2 className="text-3xl md:text-4xl font-bold text-brand-900 mb-4 tracking-tight">
                      Mocha - Luyện tập Khám Bệnh Nhi Ảo
                    </h2>
                    <p className="text-slate-500 max-w-lg mb-8 text-lg leading-relaxed">
                      Thực hành khám lâm sàng với bệnh nhân nhi ảo, sau đó nhận phản hồi chi tiết từ AI chuyên gia.
                    </p>

                    {/* RAG Database Info */}
                    <div className="flex items-center gap-2 mb-8 px-4 py-2 bg-green-50 border border-green-200 rounded-full">
                      <DatabaseIcon className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-green-700">
                        Cơ sở dữ liệu: {COMMON_DISEASES.length} bệnh lý từ BoYTe, NHIKHOA, Phác đồ điều trị
                      </span>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
                      <button 
                        onClick={() => setShowDiseaseSelector(true)}
                        className="flex-1 flex items-center justify-center gap-3 px-6 py-4 bg-primary-600 text-white rounded-2xl hover:bg-primary-700 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 font-semibold text-lg"
                      >
                        <PlayIcon className="w-6 h-6" />
                        Bắt đầu ca mới (RAG Mode)
                      </button>
                      <button 
                        onClick={handleViewHistory}
                        className="flex-1 flex items-center justify-center gap-3 px-6 py-4 bg-white border-2 border-gray-200 text-gray-700 rounded-2xl hover:border-primary-300 hover:bg-primary-50 transition-all shadow-md font-semibold text-lg"
                      >
                        <HistoryIcon className="w-6 h-6" />
                        Lịch sử luyện tập
                      </button>
                    </div>

                    {/* Quick Info Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-2xl mt-12">
                      <div className="p-4 bg-white border border-gray-200 rounded-xl text-left">
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mb-3">
                          <span className="text-xl">🩺</span>
                        </div>
                        <h3 className="font-semibold text-gray-800 mb-1">Hỏi bệnh</h3>
                        <p className="text-sm text-gray-500">Khai thác tiền sử và triệu chứng từ bệnh nhân ảo</p>
                      </div>
                      <div className="p-4 bg-white border border-gray-200 rounded-xl text-left">
                        <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mb-3">
                          <span className="text-xl">📋</span>
                        </div>
                        <h3 className="font-semibold text-gray-800 mb-1">Chẩn đoán</h3>
                        <p className="text-sm text-gray-500">Đưa ra chẩn đoán và kế hoạch điều trị</p>
                      </div>
                      <div className="p-4 bg-white border border-gray-200 rounded-xl text-left">
                        <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center mb-3">
                          <span className="text-xl">⭐</span>
                        </div>
                        <h3 className="font-semibold text-gray-800 mb-1">Đánh giá</h3>
                        <p className="text-sm text-gray-500">Nhận feedback chi tiết từ AI chuyên gia</p>
                      </div>
                    </div>

                    {/* Disease Categories Preview */}
                    <div className="w-full max-w-2xl mt-8">
                      <h3 className="text-sm font-medium text-gray-500 mb-3 text-left">Danh mục bệnh lý trong CSDL</h3>
                      <div className="flex flex-wrap gap-2">
                        {DISEASE_CATEGORIES.filter(c => c.value !== 'all').map(cat => (
                          <div key={cat.value} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-full text-sm text-gray-600">
                            <span>{cat.icon}</span>
                            <span>{cat.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                </div>
            ) : (
                // Consultation Chat
                <div className="flex flex-col py-6 w-full">
                  {messages.length === 0 && isLoading ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mb-4" />
                      <p className="text-gray-500">Đang tạo ca bệnh...</p>
                    </div>
                  ) : (
                    messages.map((msg) => (
                      <MessageBubble key={msg.id} message={msg} />
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>
            )}
          </div>
        </div>

        {/* Input Area (only show when in consultation) */}
        {currentSession && currentSession.status === 'in-progress' && (
          <InputArea onSendMessage={handleSendMessage} isLoading={isLoading} />
        )}
      </div>

      {/* Modals */}
      <CaseTypeModal
        isOpen={showCaseModal}
        onClose={() => setShowCaseModal(false)}
        onStartCase={handleStartCase}
      />

      <DiseaseSelectorModal
        isOpen={showDiseaseSelector}
        onClose={() => setShowDiseaseSelector(false)}
        onSelectDisease={handleSelectRAGDisease}
      />

      <DiagnosisForm
        isOpen={showDiagnosisForm}
        onClose={() => setShowDiagnosisForm(false)}
        onSubmit={handleSubmitDiagnosis}
        interactionCount={interactionCount}
        minInteractions={MIN_INTERACTION_TURNS}
      />

      <RAGDiagnosisForm
        isOpen={showRAGDiagnosisForm}
        onClose={() => setShowRAGDiagnosisForm(false)}
        onSubmit={handleSubmitRAGDiagnosis}
        isEvaluating={isEvaluating}
      />

      <FeedbackPanel
        isOpen={showFeedbackPanel}
        onClose={() => setShowFeedbackPanel(false)}
        evaluation={currentSession?.evaluation || null}
        ragEvaluation={currentSession?.ragEvaluation || null}
        diagnosis={currentSession?.diagnosis || null}
        ragDiagnosis={currentSession?.ragDiagnosis || null}
        patientInfo={currentSession?.patientInfo || null}
        isLoading={isEvaluating}
        onBackToHome={handleBackToHome}
        isRAGMode={currentSession?.isRAGMode || false}
      />
    </div>
  );
};

export default App;