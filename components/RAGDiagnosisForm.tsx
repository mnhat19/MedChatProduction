import React, { useState } from 'react';
import { RAGDiagnosisData } from '../types';
import { XMarkIcon, DocumentTextIcon, CheckIcon } from './Icons';

interface RAGDiagnosisFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (diagnosis: RAGDiagnosisData) => void;
  isEvaluating?: boolean;
}

const RAGDiagnosisForm: React.FC<RAGDiagnosisFormProps> = ({
  isOpen,
  onClose,
  onSubmit,
  isEvaluating = false,
}) => {
  const [formData, setFormData] = useState<RAGDiagnosisData>({
    clinical: '',
    paraclinical: '',
    definitiveDiagnosis: '',
    differentialDiagnosis: '',
    treatment: '',
    medication: '',
  });
  const [formError, setFormError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const hasContent = Object.values(formData).some(v => v.trim().length > 0);
    if (!hasContent) {
      setFormError('Vui lòng nhập ít nhất một trường thông tin');
      return;
    }
    setFormError('');
    onSubmit(formData);
  };

  const handleChange = (field: keyof RAGDiagnosisData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const resetForm = () => {
    setFormData({
      clinical: '',
      paraclinical: '',
      definitiveDiagnosis: '',
      differentialDiagnosis: '',
      treatment: '',
      medication: '',
    });
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gradient-to-r from-primary-50 to-blue-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
              <DocumentTextIcon className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Nộp Bài Chẩn Đoán</h2>
              <p className="text-sm text-gray-500">Điền các trường thông tin chẩn đoán và điều trị</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            disabled={isEvaluating}
          >
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Section 1: Chẩn đoán */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <span className="w-8 h-8 bg-primary-100 text-primary-600 rounded-lg flex items-center justify-center text-sm font-bold">1</span>
              Chẩn Đoán
            </h3>

            <div className="space-y-3 ml-10">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cận lâm sàng
                </label>
                <textarea
                  value={formData.paraclinical}
                  onChange={(e) => handleChange('paraclinical', e.target.value)}
                  placeholder="X-quang, siêu âm, xét nghiệm..."
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  rows={3}
                  disabled={isEvaluating}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Lâm sàng
                </label>
                <textarea
                  value={formData.clinical}
                  onChange={(e) => handleChange('clinical', e.target.value)}
                  placeholder="Triệu chứng, dấu hiệu lâm sàng..."
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  rows={3}
                  disabled={isEvaluating}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Chẩn đoán xác định
                </label>
                <textarea
                  value={formData.definitiveDiagnosis}
                  onChange={(e) => handleChange('definitiveDiagnosis', e.target.value)}
                  placeholder="Chẩn đoán chính xác bệnh..."
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  rows={2}
                  disabled={isEvaluating}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Chẩn đoán phân biệt
                </label>
                <textarea
                  value={formData.differentialDiagnosis}
                  onChange={(e) => handleChange('differentialDiagnosis', e.target.value)}
                  placeholder="Các bệnh cần phân biệt..."
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  rows={2}
                  disabled={isEvaluating}
                />
              </div>
            </div>
          </div>

          {/* Section 2: Kế hoạch điều trị */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <span className="w-8 h-8 bg-green-100 text-green-600 rounded-lg flex items-center justify-center text-sm font-bold">2</span>
              Kế Hoạch Điều Trị
            </h3>

            <div className="space-y-3 ml-10">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cách điều trị
                </label>
                <textarea
                  value={formData.treatment}
                  onChange={(e) => handleChange('treatment', e.target.value)}
                  placeholder="Phương pháp điều trị, biện pháp can thiệp..."
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  rows={3}
                  disabled={isEvaluating}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Thuốc
                </label>
                <textarea
                  value={formData.medication}
                  onChange={(e) => handleChange('medication', e.target.value)}
                  placeholder="Các thuốc sử dụng, liều lượng..."
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  rows={3}
                  disabled={isEvaluating}
                />
              </div>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-100 bg-gray-50">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            disabled={isEvaluating}
          >
            Hủy
          </button>

          <div className="flex items-center gap-3">
            {formError && (
              <p className="text-red-500 text-sm">{formError}</p>
            )}
            <button
              type="submit"
              onClick={handleSubmit}
              disabled={isEvaluating}
              className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isEvaluating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Đang đánh giá...
                </>
              ) : (
                <>
                  <CheckIcon className="w-5 h-5" />
                  Nộp Bài
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RAGDiagnosisForm;
