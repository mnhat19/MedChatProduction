"""
DoctorEvaluator — uses Groq LLM (via shared GroqKeyManager) for:
  1. generate_case()           : 1 LLM call
  2. detailed_evaluation()     : 1 LLM call  (compact JSON, ~4 fields)

RAG queries reduced:
  - find_symptoms              : 3 → 1 combined query
  - get_detailed_standard_knowledge : 6 → 2 combined queries
Total LLM calls per start-case: 1(symptoms RAG) + 2(standard RAG) + 1(case) = 4
Total LLM calls per evaluate  : 2(standard RAG) + 1(eval) = 3
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Tuple, List
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception
from rag_chain import RAGChain, get_key_manager, _is_rate_limit


class DoctorEvaluator:
    def __init__(self, rag: RAGChain):
        self.rag = rag
        self._km = get_key_manager()
        print("DoctorEvaluator: Ready (Groq + RAG)!")

    # ── internal helper ────────────────────────────────────────────────────────
    def _llm_invoke(self, prompt: str, temperature: float = 0.1) -> str:
        """Call Groq with retry + key rotation on 429."""
        @retry(
            retry=retry_if_exception(_is_rate_limit),
            wait=wait_exponential(multiplier=1, min=5, max=30),
            stop=stop_after_attempt(4),
            reraise=True,
        )
        def _call():
            try:
                llm = self._km.build_llm(temperature=temperature)
                return llm.invoke([prompt])
            except Exception as exc:
                if _is_rate_limit(exc):
                    self._km.mark_rate_limited(self._km.current())
                    self._km.rotate()
                raise
        return _call().content

    # ── public methods ─────────────────────────────────────────────────────────
    def generate_case(self, disease: str, symptoms: str) -> str:
        """Tạo ca bệnh nhi bằng 1 LLM call, prompt ngắn gọn."""
        prompt = (
            f"Bạn là bác sĩ nhi khoa. Tạo 1 lời thoại của mẹ bệnh nhân (2-3 câu, "
            f"ngôn ngữ đời thường) mô tả triệu chứng cụ thể của bệnh {disease}.\n"
            f"Triệu chứng từ tài liệu: {symptoms[:400]}\n"
            f"Format: 'Bé [tên] nhà chị [tên mẹ] bị [triệu chứng cụ thể]. [Thêm chi tiết].'\n"
            f"CASE:"
        )
        return self._llm_invoke(prompt, temperature=0.3).strip()

    def find_symptoms(self, disease: str) -> Tuple[str, list]:
        """1 RAG query (thay cho 3 query trước đây)."""
        answer, sources = self.rag.query(f"{disease} triệu chứng biểu hiện lâm sàng")
        summary = answer[:600] if answer else f"Không tìm thấy thông tin triệu chứng cho {disease}"
        return summary, sources

    def get_detailed_standard_knowledge(self, disease: str) -> Tuple[str, list]:
        """2 RAG queries thay cho 6 query trước đây."""
        tasks = [
            ("CHAN_DOAN", f"{disease} lâm sàng cận lâm sàng chẩn đoán xác định phân biệt"),
            ("DIEU_TRI",  f"{disease} điều trị thuốc"),
        ]

        raw: Dict[str, Tuple] = {}
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = {pool.submit(self.rag.query, q): key for key, q in tasks}
            for future in as_completed(futures):
                key = futures[future]
                try:
                    raw[key] = future.result()
                except Exception as exc:
                    print(f"[WARN] {key} query failed: {exc}")
                    raw[key] = ("Khong tim thay thong tin", [])

        all_sources: list = []
        for key, _ in tasks:
            all_sources.extend(raw.get(key, ("", []))[1])

        def r(k): return raw.get(k, ("",))[0]

        standard_text = (
            f"CHAN DOAN:\n{r('CHAN_DOAN')}\n\n"
            f"DIEU TRI:\n{r('DIEU_TRI')}"
        )
        return standard_text, all_sources

    def detailed_evaluation(self, doctor_answer: str, standard_data: str) -> str:
        """Đánh giá ngắn gọn — JSON 4 trường, tối đa 300 token output."""
        std = standard_data[:1200]
        doc = doctor_answer[:600]
        prompt = (
            "Chuyên gia y khoa đánh giá câu trả lời bác sĩ. Trả về JSON thuần túy, KHÔNG giải thích thêm.\n\n"
            f"CÂU TRẢ LỜI BÁC SĨ:\n{doc}\n\n"
            f"KIẾN THỨC CHUẨN (tóm tắt):\n{std}\n\n"
            "JSON format (ngắn gọn, mỗi mảng tối đa 3 phần tử):\n"
            '{"diem_so":"85/100","nhan_xet_tong_quan":"2 câu tóm tắt","diem_manh":["...","..."],"thieu":["...","..."]}\n\n'
            "JSON:"
        )
        return self._llm_invoke(prompt, temperature=0)
