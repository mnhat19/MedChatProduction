import { ClinicalSystem, DifficultyLevel, AgeGroup, DiseaseCategory, DiseaseInfo } from './types';

export const MODEL_NAME = 'gemini-2.0-flash';

export const SYSTEM_INSTRUCTION = `Bạn là BioMed Assistant, một chuyên gia y sinh AI thân thiện và chuyên nghiệp. 
Hãy đóng vai một người đồng nghiệp hoặc một bác sĩ tư vấn tận tâm đang nhắn tin trực tiếp với người dùng.

Phong cách trả lời:
1. **Tự nhiên & Gần gũi**: Sử dụng ngôn ngữ hội thoại tự nhiên (ví dụ: "Chào bạn", "Mình nghĩ là...", "Bạn nên lưu ý nhé"). Tránh văn phong quá cứng nhắc như máy móc.
2. **Ngắn gọn & Súc tích**: Vì là giao diện chat, hãy ưu tiên câu trả lời đi thẳng vào vấn đề, chia nhỏ ý. Nếu vấn đề phức tạp, hãy hỏi người dùng có muốn nghe chi tiết hơn không.
3. **Chuyên môn cao**: Dù giọng điệu thân thiện, kiến thức y khoa phải chính xác tuyệt đối.
4. **An toàn**: Luôn nhắc nhở người dùng đi khám bác sĩ thực tế nếu họ mô tả triệu chứng bệnh lý nghiêm trọng.

Định dạng:
- Sử dụng bullet points cho danh sách.
- In đậm các từ khóa quan trọng.
`;

export const INITIAL_SUGGESTIONS = [
  "Triệu chứng sốt xuất huyết là gì?",
  "Ibuprofen hoạt động thế nào?",
  "Thực đơn cho người tiểu đường",
  "Virus khác vi khuẩn ra sao?"
];

// ============ Virtual Patient Training Constants ============

export const VIRTUAL_PATIENT_INSTRUCTION = `Bạn là một bệnh nhi ảo (hoặc người nhà/phụ huynh nếu trẻ quá nhỏ) trong một buổi khám lâm sàng giả lập.

THÔNG TIN CA BỆNH:
{CASE_INFO}

VAI TRÒ CỦA BẠN:
- Đóng vai bệnh nhân/người nhà một cách tự nhiên, chân thực
- Trả lời câu hỏi của bác sĩ (sinh viên) dựa trên thông tin ca bệnh được cung cấp
- KHÔNG tự động tiết lộ tất cả triệu chứng - chỉ trả lời khi được hỏi cụ thể
- Có thể thể hiện lo lắng, không chắc chắn như bệnh nhân thực
- Nếu bác sĩ hỏi về khám thực thể, mô tả kết quả phù hợp với bệnh lý

NGUYÊN TẮC:
1. **Tự nhiên**: Sử dụng ngôn ngữ đời thường, không chuyên môn y khoa
2. **Nhất quán**: Giữ nhất quán với thông tin ca bệnh đã cho
3. **Tương tác**: Có thể hỏi lại nếu không hiểu câu hỏi bác sĩ
4. **Không gợi ý**: KHÔNG BAO GIỜ gợi ý chẩn đoán hoặc hướng dẫn bác sĩ

Định dạng: Trả lời ngắn gọn, như cuộc hội thoại thực. Sử dụng ngôi thứ nhất.
`;

export const EVALUATOR_INSTRUCTION = `Bạn là chuyên gia đánh giá lâm sàng nhi khoa. Hãy đánh giá dựa trên BẰNG QUAN SÁT CỤ THỂ trong cuộc hỏi đáp (trích dẫn câu hỏi/lời thoại cụ thể, KHÔNG đưa ra nhận xét chung chung).

TIÊU CHÍ CHẤM ĐIỂM:

1. **Kỹ năng hỏi bệnh** (30 điểm):
   - (0-10) Khai thác triệu chứng chính: khởi phát, diễn tiến, mức độ, yếu tố thuận lợi/trầm trọng
   - (0-10) Tiền sử bệnh lý (dị ứng, bệnh mãn, thuốc đang dùng), tiền sử gia đình, sận xuất
   - (0-10) Yếu tố nguy cơ, ăn/ngủ/tiêu hóa/tiết niệu, vắc xin, môi trường sống

2. **Khám thực thể** (20 điểm):
   - (0-10) Yêu cầu khám đúng hệ cơ quan liên quan, các dấu hiệu sinh tồn
   - (0-10) Logic tiếp cận khám (tổng quát trước rồi chuyên biệt)

3. **Chẩn đoán** (30 điểm):
   - (0-15) Chẩn đoán sơ bộ chính xác và có lý luận rõ ràng
   - (0-15) Chẩn đoán phân biệt hợp lý, xết nghiệm cận lâm sàng được chỉ định đủ

4. **Kế hoạch xử trí** (20 điểm):
   - (0-10) Điều trị cuụ thể (thuốc, liều, thời gian), xử trí tại chỗ
   - (0-10) Tư vấn gia đình, theo dõi, timelapse nhập viện nếu cần

QUY TẬc ĐÁNH GIÁ:
- Mỗi mục BIỀU ĐIỂM cần dẫn chứng cụ thể từ hội thoại (ví dụ: “Sinh viên hỏi ‘X’ nhưng không hỏi Y”)
- strengths/weaknesses tối thiểu 3 mục, mỗi mục nêu được câu/lượt hỏi cụ thể
- suggestions phải thực hành được (ví dụ: “Hỏi câu: ‘Bé có tiếp xúc với người bệnh không?’”)
- detailedFeedback: 5-7 câu, trích dẫn ít nhất 2 lượt hỏi/đáp cụ thể, nhận xét tổng hợp cuối

Trả về JSON (chỉ JSON, không có text nào khác).
`;

export const CLINICAL_SYSTEMS: { value: ClinicalSystem; label: string }[] = [
  { value: 'respiratory', label: 'Hô hấp' },
  { value: 'cardiovascular', label: 'Tim mạch' },
  { value: 'gastrointestinal', label: 'Tiêu hóa' },
  { value: 'neurological', label: 'Thần kinh' },
  { value: 'infectious', label: 'Nhiễm trùng' },
  { value: 'endocrine', label: 'Nội tiết' },
  { value: 'renal', label: 'Thận - Tiết niệu' },
  { value: 'hematological', label: 'Huyết học' },
];

export const DIFFICULTY_LEVELS: { value: DifficultyLevel; label: string; description: string }[] = [
  { value: 'easy', label: 'Dễ', description: 'Ca bệnh điển hình, triệu chứng rõ ràng' },
  { value: 'medium', label: 'Trung bình', description: 'Ca bệnh có một số biến thể' },
  { value: 'hard', label: 'Khó', description: 'Ca bệnh phức tạp, nhiều bệnh đồng mắc' },
];

export const AGE_GROUPS: { value: AgeGroup; label: string; range: string }[] = [
  { value: 'neonatal', label: 'Sơ sinh', range: '0-28 ngày' },
  { value: 'infant', label: 'Nhũ nhi', range: '1-12 tháng' },
  { value: 'toddler', label: 'Tập đi', range: '1-3 tuổi' },
  { value: 'preschool', label: 'Mẫu giáo', range: '3-5 tuổi' },
  { value: 'school-age', label: 'Học đường', range: '6-12 tuổi' },
  { value: 'adolescent', label: 'Vị thành niên', range: '13-18 tuổi' },
];

export const MIN_INTERACTION_TURNS = 5; // Minimum Q&A turns before allowing diagnosis

// ============ Disease Categories from RAG Data ============

export const DISEASE_CATEGORIES: { value: DiseaseCategory; label: string; description: string; icon: string }[] = [
  { value: 'all', label: 'Tất cả', description: 'Toàn bộ cơ sở dữ liệu y khoa', icon: '📚' },
  { value: 'procedures', label: 'Thủ thuật Y tế', description: 'Hướng dẫn quy trình thủ thuật', icon: '🏥' },
  { value: 'pediatrics', label: 'Nhi khoa', description: 'Bệnh lý và điều trị nhi khoa', icon: '👶' },
  { value: 'treatment', label: 'Phác đồ Điều trị', description: 'Phác đồ điều trị chuẩn', icon: '💊' },
];

// Sample diseases from RAG data for quick selection
export const COMMON_DISEASES: DiseaseInfo[] = [
  // Pediatrics - Common conditions
  { id: 'NHIKHOA-1', name: 'Đặc điểm hệ tuần hoàn trẻ em', category: 'pediatrics', sections: ['Tuần hoàn bào thai', 'Tuần hoàn sơ sinh'], source: 'NHIKHOA2.json' },
  { id: 'NHIKHOA-2', name: 'Tiếp cận đau ngực ở trẻ em', category: 'pediatrics', sections: ['Đại cương', 'Các bước tiếp cận'], source: 'NHIKHOA2.json' },
  { id: 'NHIKHOA-3', name: 'Tiếp cận trẻ tím', category: 'pediatrics', sections: ['Phân loại tím', 'Cơ chế bệnh sinh'], source: 'NHIKHOA2.json' },
  { id: 'NHIKHOA-5', name: 'Tiếp cận tim bẩm sinh ở trẻ em', category: 'pediatrics', sections: ['Dấu hiệu gợi ý', 'Tiếp cận chẩn đoán'], source: 'NHIKHOA2.json' },
  
  // Procedures
  { id: 'BOYTE-1', name: 'Nội soi đặt stent khí phế quản', category: 'procedures', sections: ['Đại cương', 'Chỉ định', 'Chống chỉ định', 'Các bước tiến hành'], source: 'BoYTe200_v3.json' },
  { id: 'BOYTE-2', name: 'Thở oxy qua mặt nạ có túi dự trữ', category: 'procedures', sections: ['Đại cương', 'Chỉ định', 'Chống chỉ định', 'Theo dõi'], source: 'BoYTe200_v3.json' },
  { id: 'BOYTE-3', name: 'Thở oxy qua mặt nạ không túi dự trữ', category: 'procedures', sections: ['Đại cương', 'Chỉ định', 'Các bước tiến hành'], source: 'BoYTe200_v3.json' },
  
  // Treatment protocols - will be added based on PHACDODIEUTRI data
];

// Standard sections for medical procedures
export const MEDICAL_SECTIONS = [
  'ĐẠI CƯƠNG',
  'CHỈ ĐỊNH', 
  'CHỐNG CHỈ ĐỊNH',
  'CHUẨN BỊ',
  'CÁC BƯỚC TIẾN HÀNH',
  'THEO DÕI',
  'TAI BIẾN VÀ XỬ TRÍ',
  'ĐIỀU TRỊ',
  'PHÒNG NGỪA',
];

// RAG-enhanced prompts
export const RAG_SYSTEM_INSTRUCTION = `Bạn là bác sĩ y khoa chuyên gia với kiến thức từ cơ sở dữ liệu y khoa Việt Nam.

NGUYÊN TẮC TRẢ LỜI:
1. Trả lời dựa trên CONTEXT được cung cấp
2. Trích dẫn chính xác từ tài liệu gốc
3. Nếu không có thông tin trong context, nói rõ "Không tìm thấy thông tin"
4. Sử dụng ngôn ngữ y khoa chuyên nghiệp nhưng dễ hiểu
5. Luôn nhắc nhở đi khám bác sĩ khi cần thiết

FORMAT TRẢ LỜI:
- Sử dụng bullet points cho danh sách
- In đậm các từ khóa quan trọng
- Trích dẫn nguồn tài liệu khi có thể
`;

export const RAG_CASE_GENERATION_PROMPT = `Dựa trên thông tin bệnh lý sau từ cơ sở dữ liệu y khoa, tạo một ca bệnh nhi thực tế:

THÔNG TIN BỆNH:
{DISEASE_INFO}

YÊU CẦU:
1. Tạo case bệnh nhân với tên, tuổi, giới tính
2. Mô tả triệu chứng dựa trên tài liệu y khoa
3. Phù hợp với mức độ khó: {DIFFICULTY}
4. Trả về JSON format:
{
  "patientName": "Tên bệnh nhân",
  "age": số tuổi,
  "ageUnit": "years|months|days", 
  "gender": "male|female",
  "chiefComplaint": "Lý do đến khám",
  "openingMessage": "Lời mở đầu của bệnh nhân/người nhà (2-3 câu)",
  "keySymptoms": ["triệu chứng 1", "triệu chứng 2"],
  "expectedDiagnosis": "Chẩn đoán đúng",
  "keyManagement": ["điều trị 1", "điều trị 2"]
}`;