import React, { useState, useEffect } from 'react';
import { CaseConfig, AgeGroup } from '../types';
import { CLINICAL_SYSTEMS, DIFFICULTY_LEVELS, AGE_GROUPS, DISEASE_CATEGORIES, COMMON_DISEASES } from '../constants';
import { XMarkIcon, ShuffleIcon, SettingsIcon, PlayIcon, ChevronRightIcon, BookOpenIcon } from './Icons';
import { ragService, Disease, CategoryCount } from '../services/ragService';

interface CaseTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartCase: (config: CaseConfig) => void;
}

const CaseTypeModal: React.FC<CaseTypeModalProps> = ({ isOpen, onClose, onStartCase }) => {
  const [step, setStep] = useState<'select' | 'customize' | 'disease'>('select');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [config, setConfig] = useState<CaseConfig>({
    caseType: 'random',
  });
  
  // RAG API states
  const [ragDiseases, setRagDiseases] = useState<Disease[]>([]);
  const [ragCategories, setRagCategories] = useState<CategoryCount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [ragAvailable, setRagAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Fetch diseases from RAG API when step changes to 'disease'
  useEffect(() => {
    if (step === 'disease') {
      fetchDiseases();
    }
  }, [step]);
  
  // Check RAG availability on mount
  useEffect(() => {
    checkRagHealth();
  }, []);
  
  const checkRagHealth = async () => {
    try {
      const health = await ragService.checkHealth();
      setRagAvailable(health.status === 'healthy');
    } catch {
      setRagAvailable(false);
    }
  };
  
  const fetchDiseases = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const diseases = await ragService.getDiseases();
      setRagDiseases(diseases);
      // Extract categories from diseases
      const categoryMap = new Map<string, number>();
      diseases.forEach(d => {
        categoryMap.set(d.category, (categoryMap.get(d.category) || 0) + 1);
      });
      const cats: CategoryCount[] = Array.from(categoryMap.entries()).map(([name, count]) => ({ name, count }));
      setRagCategories(cats);
    } catch (err) {
      setError('Không thể kết nối đến CSDL Y khoa. Vui lòng thử lại.');
      console.error('Failed to fetch diseases:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectRandom = () => {
    onStartCase({ caseType: 'random' });
    resetAndClose();
  };

  const handleSelectCustomised = () => {
    setStep('customize');
    setConfig({ ...config, caseType: 'customised' });
  };

  const handleSelectDisease = () => {
    // Instead of showing diseases in this modal, trigger parent to open DiseaseSelector
    onStartCase({ 
      caseType: 'customised',
      diseaseId: '__TRIGGER_DISEASE_SELECTOR__', // Flag to open selector
      diseaseName: ''
    });
    resetAndClose();
  };

  const handleStartWithDisease = (diseaseId: string, diseaseName: string) => {
    onStartCase({ 
      caseType: 'customised',
      diseaseId,
      diseaseName,
      difficulty: config.difficulty || 'medium'
    });
    resetAndClose();
  };

  // Use RAG diseases if available, otherwise fall back to hardcoded ones
  const diseasesToFilter = ragAvailable && ragDiseases.length > 0 ? ragDiseases : COMMON_DISEASES;
  
  const filteredDiseases = diseasesToFilter.filter(d => {
    const matchCategory = selectedCategory === 'all' || d.category === selectedCategory;
    const matchSearch = searchQuery === '' || 
      d.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });

  const handleStartCustomised = () => {
    // Validate required fields
    if (!config.clinicalSystem) {
      alert('Vui lòng chọn hệ cơ quan lâm sàng');
      return;
    }
    onStartCase(config);
    resetAndClose();
  };

  const resetAndClose = () => {
    setStep('select');
    setConfig({ caseType: 'random' });
    setSearchQuery('');
    setSelectedCategory('all');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {step === 'select' ? 'Bắt đầu ca luyện tập' : step === 'disease' ? 'Chọn bệnh lý từ CSDL' : 'Tùy chỉnh ca bệnh'}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {step === 'select' 
                ? 'Chọn loại ca bệnh bạn muốn luyện tập' 
                : step === 'disease'
                ? 'Chọn bệnh lý cụ thể từ cơ sở dữ liệu y khoa'
                : 'Điều chỉnh các thông số cho ca bệnh'}
            </p>
          </div>
          <button
            onClick={resetAndClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {step === 'select' ? (
            <div className="space-y-4">
              {/* Random Case Option */}
              <button
                onClick={handleSelectRandom}
                className="w-full p-5 bg-gradient-to-br from-primary-50 to-blue-50 border-2 border-primary-200 rounded-xl hover:border-primary-400 hover:shadow-lg transition-all group text-left"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center group-hover:bg-primary-200 transition-colors">
                    <ShuffleIcon className="w-6 h-6 text-primary-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
                      Ca ngẫu nhiên
                      <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full">Khuyến nghị</span>
                    </h3>
                    <p className="text-sm text-gray-600">
                      Hệ thống sẽ tự động chọn ngẫu nhiên một ca bệnh phù hợp với trình độ của bạn
                    </p>
                  </div>
                  <ChevronRightIcon className="w-5 h-5 text-gray-400 group-hover:text-primary-500 transition-colors" />
                </div>
              </button>

              {/* Disease from Database Option */}
              <button
                onClick={handleSelectDisease}
                className="w-full p-5 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl hover:border-green-400 hover:shadow-lg transition-all group text-left"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center group-hover:bg-green-200 transition-colors">
                    <BookOpenIcon className="w-6 h-6 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
                      Chọn từ CSDL Y khoa
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">RAG</span>
                    </h3>
                    <p className="text-sm text-gray-600">
                      Chọn bệnh lý cụ thể từ cơ sở dữ liệu Nhi khoa, Thủ thuật, Phác đồ điều trị
                    </p>
                  </div>
                  <ChevronRightIcon className="w-5 h-5 text-gray-400 group-hover:text-green-500 transition-colors" />
                </div>
              </button>

              {/* Customised Case Option */}
              <button
                onClick={handleSelectCustomised}
                className="w-full p-5 bg-gray-50 border-2 border-gray-200 rounded-xl hover:border-gray-300 hover:shadow-lg transition-all group text-left"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                    <SettingsIcon className="w-6 h-6 text-gray-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1">Ca tùy chỉnh</h3>
                    <p className="text-sm text-gray-600">
                      Tự chọn hệ cơ quan, độ tuổi và mức độ khó của ca bệnh
                    </p>
                  </div>
                  <ChevronRightIcon className="w-5 h-5 text-gray-400 group-hover:text-gray-500 transition-colors" />
                </div>
              </button>
            </div>
          ) : step === 'disease' ? (
            <div className="space-y-4">
              {/* Search */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Tìm kiếm bệnh lý..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full p-3 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
                <svg className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

              {/* Category Filter - Use dynamic categories from RAG when available */}
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setSelectedCategory('all')}
                  className={`px-3 py-1.5 text-sm rounded-full transition-all flex items-center gap-1.5 ${
                    selectedCategory === 'all'
                      ? 'bg-primary-100 text-primary-700 font-medium border-2 border-primary-300'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border-2 border-transparent'
                  }`}
                >
                  <span>📚</span>
                  Tất cả {ragCategories.length > 0 && `(${ragDiseases.length})`}
                </button>
                {ragCategories.length > 0 ? (
                  ragCategories.map((cat) => (
                    <button
                      key={cat.name}
                      onClick={() => setSelectedCategory(cat.name)}
                      className={`px-3 py-1.5 text-sm rounded-full transition-all flex items-center gap-1.5 ${
                        selectedCategory === cat.name
                          ? 'bg-primary-100 text-primary-700 font-medium border-2 border-primary-300'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border-2 border-transparent'
                      }`}
                    >
                      {cat.name === 'Quy trình kỹ thuật' ? '🏥' : cat.name === 'Lý thuyết nhi khoa' ? '👶' : '💊'}
                      {cat.name} ({cat.count})
                    </button>
                  ))
                ) : (
                  DISEASE_CATEGORIES.filter(c => c.value !== 'all').map((cat) => (
                    <button
                      key={cat.value}
                      onClick={() => setSelectedCategory(cat.value)}
                      className={`px-3 py-1.5 text-sm rounded-full transition-all flex items-center gap-1.5 ${
                        selectedCategory === cat.value
                          ? 'bg-primary-100 text-primary-700 font-medium border-2 border-primary-300'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border-2 border-transparent'
                      }`}
                    >
                      <span>{cat.icon}</span>
                      {cat.label}
                    </button>
                  ))
                )}
              </div>

              {/* Difficulty selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Mức độ khó</label>
                <div className="flex gap-2">
                  {DIFFICULTY_LEVELS.map((level) => (
                    <button
                      key={level.value}
                      onClick={() => setConfig({ ...config, difficulty: level.value })}
                      className={`flex-1 p-2 text-sm rounded-lg border-2 transition-all ${
                        config.difficulty === level.value
                          ? 'border-primary-500 bg-primary-50 text-primary-700 font-medium'
                          : 'border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      {level.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Disease List */}
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {isLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full mx-auto mb-3"></div>
                    <p className="text-gray-500">Đang tải dữ liệu từ CSDL Y khoa...</p>
                    <p className="text-xs text-gray-400 mt-1">({ragDiseases.length > 0 ? ragDiseases.length : '360+'} bệnh lý)</p>
                  </div>
                ) : error ? (
                  <div className="text-center py-8 text-red-500">
                    <p className="mb-2">{error}</p>
                    <button
                      onClick={fetchDiseases}
                      className="text-sm bg-red-50 px-4 py-2 rounded-lg hover:bg-red-100 transition-colors"
                    >
                      Thử lại
                    </button>
                  </div>
                ) : filteredDiseases.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <p>Không tìm thấy bệnh lý phù hợp</p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-gray-400 text-center mb-2">
                      {ragAvailable ? `${filteredDiseases.length}/${ragDiseases.length} bệnh lý từ CSDL RAG` : `${filteredDiseases.length} bệnh lý mẫu`}
                    </p>
                    {filteredDiseases.slice(0, 50).map((disease) => (
                    <button
                      key={disease.id}
                      onClick={() => handleStartWithDisease(disease.id, disease.name)}
                      className="w-full p-4 bg-white border border-gray-200 rounded-xl hover:border-primary-300 hover:bg-primary-50 transition-all text-left group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-gray-900 group-hover:text-primary-700 truncate">
                            {disease.name}
                          </h4>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              disease.category === 'Quy trình kỹ thuật' || disease.category === 'procedures' ? 'bg-blue-100 text-blue-700' :
                              disease.category === 'Lý thuyết nhi khoa' || disease.category === 'pediatrics' ? 'bg-green-100 text-green-700' :
                              'bg-purple-100 text-purple-700'
                            }`}>
                              {disease.category}
                            </span>
                            <span className="text-xs text-gray-400">{disease.source}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1 truncate">
                            {disease.sections.slice(0, 3).join(' • ')}
                          </p>
                        </div>
                        <ChevronRightIcon className="w-5 h-5 text-gray-300 group-hover:text-primary-500 flex-shrink-0" />
                      </div>
                    </button>
                  ))}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Clinical System */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Hệ cơ quan lâm sàng <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {CLINICAL_SYSTEMS.map((system) => (
                    <button
                      key={system.value}
                      onClick={() => setConfig({ ...config, clinicalSystem: system.value })}
                      className={`p-3 text-sm rounded-lg border-2 transition-all ${
                        config.clinicalSystem === system.value
                          ? 'border-primary-500 bg-primary-50 text-primary-700 font-medium'
                          : 'border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      {system.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Age Group */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nhóm tuổi
                </label>
                <select
                  value={config.ageGroup || ''}
                  onChange={(e) => setConfig({ ...config, ageGroup: e.target.value as AgeGroup || undefined })}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">Bất kỳ</option>
                  {AGE_GROUPS.map((age) => (
                    <option key={age.value} value={age.value}>
                      {age.label} ({age.range})
                    </option>
                  ))}
                </select>
              </div>

              {/* Difficulty */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Mức độ khó
                </label>
                <div className="flex gap-2">
                  {DIFFICULTY_LEVELS.map((level) => (
                    <button
                      key={level.value}
                      onClick={() => setConfig({ ...config, difficulty: level.value })}
                      className={`flex-1 p-3 text-sm rounded-lg border-2 transition-all ${
                        config.difficulty === level.value
                          ? 'border-primary-500 bg-primary-50 text-primary-700 font-medium'
                          : 'border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      <div className="font-medium">{level.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 pt-0 flex gap-3 border-t border-gray-100 mt-auto">
          {step === 'customize' && (
            <>
              <button
                onClick={() => setStep('select')}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Quay lại
              </button>
              <button
                onClick={handleStartCustomised}
                className="flex-1 px-4 py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition-colors flex items-center justify-center gap-2"
              >
                <PlayIcon className="w-5 h-5" />
                Bắt đầu
              </button>
            </>
          )}
          {step === 'disease' && (
            <button
              onClick={() => setStep('select')}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition-colors"
            >
              Quay lại
            </button>
          )}
          {step === 'select' && (
            <button
              onClick={resetAndClose}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition-colors"
            >
              Hủy
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CaseTypeModal;
