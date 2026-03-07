import React, { useState } from 'react';
import { DiagnosisSubmission } from '../types';
import { XMarkIcon, DocumentTextIcon, CheckIcon } from './Icons';

interface DiagnosisFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (diagnosis: DiagnosisSubmission) => void;
  interactionCount: number;
  minInteractions: number;
}

const DiagnosisForm: React.FC<DiagnosisFormProps> = ({
  isOpen,
  onClose,
  onSubmit,
  interactionCount,
  minInteractions,
}) => {
  const [provisionalDiagnosis, setProvisionalDiagnosis] = useState('');
  const [differentialDiagnoses, setDifferentialDiagnoses] = useState(['', '', '']);
  const [managementPlan, setManagementPlan] = useState('');
  const [showWarning, setShowWarning] = useState(false);
  const [errors, setErrors] = useState<{ provisional?: string; management?: string }>({});

  const canSubmit = interactionCount >= minInteractions;

  const handleSubmit = () => {
    const newErrors: { provisional?: string; management?: string } = {};
    if (!provisionalDiagnosis.trim()) {
      newErrors.provisional = 'Vui lòng nhập chẩn đoán sơ bộ';
    }
    if (!managementPlan.trim()) {
      newErrors.management = 'Vui lòng nhập kế hoạch xử trí';
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});

    if (!canSubmit && !showWarning) {
      setShowWarning(true);
      return;
    }

    const submission: DiagnosisSubmission = {
      provisionalDiagnosis: provisionalDiagnosis.trim(),
      differentialDiagnoses: differentialDiagnoses.filter(d => d.trim()),
      managementPlan: managementPlan.trim(),
      submittedAt: Date.now(),
    };

    onSubmit(submission);
    resetForm();
  };

  const resetForm = () => {
    setProvisionalDiagnosis('');
    setDifferentialDiagnoses(['', '', '']);
    setManagementPlan('');
    setShowWarning(false);
  };

  const handleClose = () => {
    setShowWarning(false);
    onClose();
  };

  const updateDifferential = (index: number, value: string) => {
    const newDiffs = [...differentialDiagnoses];
    newDiffs[index] = value;
    setDifferentialDiagnoses(newDiffs);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gradient-to-r from-primary-50 to-blue-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
              <DocumentTextIcon className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Chẩn đoán & Xử trí</h2>
              <p className="text-sm text-gray-500">Ghi nhận kết quả khám và kế hoạch điều trị</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-white/50 rounded-lg transition-colors"
          >
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Warning Banner */}
        {showWarning && (
          <div className="mx-6 mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-amber-600 text-lg">⚠️</span>
              </div>
              <div>
                <h4 className="font-medium text-amber-800">Số lượng tương tác còn ít</h4>
                <p className="text-sm text-amber-700 mt-1">
                  Bạn mới thực hiện {interactionCount}/{minInteractions} lượt hỏi đáp. 
                  Việc chẩn đoán sớm có thể ảnh hưởng đến điểm đánh giá. Bạn có chắc muốn tiếp tục?
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setShowWarning(false)}
                    className="px-3 py-1.5 text-sm bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 transition-colors"
                  >
                    Quay lại hỏi thêm
                  </button>
                  <button
                    onClick={() => {
                      setShowWarning(false);
                      handleSubmit();
                    }}
                    className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                  >
                    Tiếp tục nộp
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Form Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Provisional Diagnosis */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Chẩn đoán sơ bộ <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={provisionalDiagnosis}
              onChange={(e) => {
                setProvisionalDiagnosis(e.target.value);
                if (errors.provisional) setErrors(prev => ({ ...prev, provisional: undefined }));
              }}
              placeholder="VD: Viêm phổi cộng đồng"
              className={`w-full p-3 border rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all ${
                errors.provisional ? 'border-red-400 bg-red-50' : 'border-gray-300'
              }`}
            />
            {errors.provisional && (
              <p className="text-red-500 text-sm mt-1">{errors.provisional}</p>
            )}
          </div>

          {/* Differential Diagnoses */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Chẩn đoán phân biệt
            </label>
            <div className="space-y-2">
              {differentialDiagnoses.map((diff, index) => (
                <input
                  key={index}
                  type="text"
                  value={diff}
                  onChange={(e) => updateDifferential(index, e.target.value)}
                  placeholder={`Chẩn đoán phân biệt ${index + 1}`}
                  className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all"
                />
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">Có thể để trống nếu không có chẩn đoán phân biệt</p>
          </div>

          {/* Management Plan */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Kế hoạch xử trí <span className="text-red-500">*</span>
            </label>
            <textarea
              value={managementPlan}
              onChange={(e) => {
                setManagementPlan(e.target.value);
                if (errors.management) setErrors(prev => ({ ...prev, management: undefined }));
              }}
              placeholder="Mô tả kế hoạch điều trị, xét nghiệm cần làm, thuốc điều trị, tư vấn cho bệnh nhân/gia đình..."
              rows={5}
              className={`w-full p-3 border rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all resize-none ${
                errors.management ? 'border-red-400 bg-red-50' : 'border-gray-300'
              }`}
            />
            {errors.management && (
              <p className="text-red-500 text-sm mt-1">{errors.management}</p>
            )}
          </div>

          {/* Interaction Count Info */}
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl">
            <div className={`w-2 h-2 rounded-full ${canSubmit ? 'bg-green-500' : 'bg-amber-500'}`} />
            <span className="text-sm text-gray-600">
              Số lượt hỏi đáp: <strong>{interactionCount}</strong>
              {!canSubmit && <span className="text-amber-600"> (tối thiểu {minInteractions})</span>}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 pt-0 flex gap-3">
          <button
            onClick={handleClose}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            Quay lại khám
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 px-4 py-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
          >
            <CheckIcon className="w-5 h-5" />
            Nộp đánh giá
          </button>
        </div>
      </div>
    </div>
  );
};

export default DiagnosisForm;
