"""
FastAPI Server để tích hợp RAG vào Chatbot
Endpoints:
- GET /api/health - Health check
- GET /api/diseases - Lấy danh sách bệnh từ JSON
- POST /api/start-case - Nhận bệnh, tạo case với triệu chứng
- POST /api/evaluate - Nhận đáp án user, trả về kết quả so sánh
- Docs: http://localhost:8001/docs (Swagger UI)
"""
import sys
import io

# Fix encoding for Vietnamese characters in Windows console
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import asyncio

from fastapi import FastAPI, HTTPException, Depends, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security.api_key import APIKeyHeader
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import json
import sys
import os
import uvicorn

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from data_loader import DataLoader
from config import Config
from doctor_evaluator import DoctorEvaluator
from vector_store import VectorStoreManager
from rag_chain import RAGChain
from session_store import SessionStore
from disease_cache import DiseaseCache

app = FastAPI(
    title="Medical RAG API",
    description="RAG-based Medical Diagnosis Assistant",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Configure CORS — restrict to known frontend origins via ALLOWED_ORIGINS env var
_allowed_origins_env = os.getenv(
    "ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173"
)
ALLOWED_ORIGINS = [o.strip() for o in _allowed_origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Optional API key authentication (set API_SECRET_KEY env var to enable)
_API_SECRET_KEY = os.getenv("API_SECRET_KEY", "")
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(api_key: str = Security(_api_key_header)):
    """If API_SECRET_KEY is configured, require matching X-API-Key header."""
    if _API_SECRET_KEY and api_key != _API_SECRET_KEY:
        raise HTTPException(status_code=403, detail="Invalid or missing API key")
    return api_key

# Initialize RAG system
print("[*] Initializing RAG system...")
vs_manager = VectorStoreManager()
if not vs_manager.vector_store:
    print("[ERROR] FAISS index not found. Run: python build_faiss.py")
    sys.exit(1)

rag = RAGChain(vs_manager)
evaluator = DoctorEvaluator(rag)
print("[OK] RAG system ready!")

# Persistent session store (SQLite)
session_store = SessionStore()
session_store.cleanup_expired()   # remove stale sessions from previous runs

# Disease-level result cache (7-day TTL, avoids repeating RAG queries for same disease)
disease_cache = DiseaseCache()


# Pydantic models for request/response
class HealthResponse(BaseModel):
    status: str
    message: str
    embedding_model: str


class Disease(BaseModel):
    id: str
    name: str
    category: str
    source: str
    sections: List[str]


class DiseasesResponse(BaseModel):
    success: bool
    diseases: List[Disease]
    total: int


class StartCaseRequest(BaseModel):
    disease: str
    sessionId: str


class StartCaseResponse(BaseModel):
    success: bool
    sessionId: str
    case: str
    symptoms: str
    sources: List[Dict[str, str]]


class DiagnosisData(BaseModel):
    clinical: Optional[str] = ""
    paraclinical: Optional[str] = ""
    definitiveDiagnosis: Optional[str] = ""
    differentialDiagnosis: Optional[str] = ""
    treatment: Optional[str] = ""
    medication: Optional[str] = ""


class EvaluateRequest(BaseModel):
    sessionId: str
    diagnosis: DiagnosisData


class EvaluateResponse(BaseModel):
    success: bool
    case: str
    standardAnswer: Dict[str, Any]
    evaluation: Dict[str, Any]
    sources: List[Dict[str, str]]


@app.get("/api/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status='healthy',
        message='FastAPI RAG Server is running',
        embedding_model=Config.EMBEDDING_MODEL
    )


@app.get("/api/diseases", response_model=DiseasesResponse)
async def get_diseases(
    category: Optional[str] = None,
    search: Optional[str] = None
):
    """
    Lấy danh sách bệnh từ 3 file JSON (Index field)
    Query params:
    - category: Filter by category (procedures, pediatrics, treatment)
    - search: Search in disease names
    """
    try:
        diseases = []
        data_dir = os.path.join(os.path.dirname(__file__), 'data')
        
        # Mapping files to categories
        files = [
            ('BoYTe200_v3.json', 'procedures'),
            ('NHIKHOA2.json', 'pediatrics'),
            ('PHACDODIEUTRI_2016.json', 'treatment')
        ]
        
        for filename, cat in files:
            # Filter by category if specified
            if category and category != 'all' and category != cat:
                continue
                
            filepath = os.path.join(data_dir, filename)
            if not os.path.exists(filepath):
                continue
                
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for item in data:
                    disease_name = item.get('Index', '')
                    
                    # Filter by search if specified
                    if search and search.lower() not in disease_name.lower():
                        continue
                    
                    diseases.append(Disease(
                        id=f"{cat}_{item['id']}",
                        name=disease_name,
                        category=cat,
                        source=filename,
                        sections=item.get('level1_items', [])
                    ))
        
        return DiseasesResponse(
            success=True,
            diseases=diseases,
            total=len(diseases)
        )
    
    except Exception as e:
        print(f"[ERROR] Error in get_diseases: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/start-case", response_model=StartCaseResponse, dependencies=[Depends(verify_api_key)])
async def start_case(request: StartCaseRequest):
    """
    1. find_symptoms() + get_detailed_standard_knowledge() run IN PARALLEL
    2. generate_case() runs after symptoms are ready
    3. Session persisted to SQLite
    """
    try:
        disease = request.disease.strip()
        session_id = request.sessionId

        if not disease:
            raise HTTPException(status_code=400, detail="Disease name is required")

        print(f"[INFO] Starting case for disease: {disease}")
        print(f"[INFO] Session ID: {session_id}")

        loop = asyncio.get_running_loop()

        # Check disease-level cache first (0 LLM calls if HIT)
        cached = disease_cache.get(disease)
        if cached:
            print(f"[INFO] Disease cache HIT for '{disease}' — skipping RAG queries")
            symptoms = cached["symptoms"]
            standard_data = cached["standard"]
            all_sources_raw = cached["sources"]
        else:
            # Cache MISS — run symptoms + standard in parallel, then cache results
            print("[INFO] Disease cache MISS — running RAG queries in parallel...")
            (symptoms, symptom_sources), (standard_data, std_sources) = await asyncio.gather(
                loop.run_in_executor(None, evaluator.find_symptoms, disease),
                loop.run_in_executor(None, evaluator.get_detailed_standard_knowledge, disease),
            )
            all_sources_raw = symptom_sources + std_sources
            # Cache for future requests
            disease_cache.set(disease, symptoms, standard_data, [
                {"file": d.metadata.get("source_file",""), "title": d.metadata.get("chunk_title",""),
                 "section": d.metadata.get("section_title","")} for d in all_sources_raw[:5]
            ])

        print(f"[INFO] Symptoms (first 200 chars): {symptoms[:200]}...")
        print(f"[INFO] Standard data length: {len(standard_data)} chars")

        # Step 2: generate case (depends on symptoms output)
        print("[INFO] Step 2: Generating patient case...")
        patient_case = await loop.run_in_executor(
            None, evaluator.generate_case, disease, symptoms
        )
        print(f"[INFO] Generated case (first 200 chars): {patient_case[:200]}...")

        # Pre-format sources (Document objects or plain dicts -> plain dicts for JSON storage)
        formatted_sources = []
        for src in (all_sources_raw if not cached else all_sources_raw)[:5]:
            if isinstance(src, dict):
                formatted_sources.append(src)
            else:
                formatted_sources.append({
                    'file':    src.metadata.get('source_file', ''),
                    'title':   src.metadata.get('chunk_title', ''),
                    'section': src.metadata.get('section_title', ''),
                })

        # Persist session to SQLite
        session_store.set(session_id, {
            'disease': disease,
            'case': patient_case,
            'symptoms': symptoms,
            'standard': standard_data,
            'sources': formatted_sources,
        })

        return StartCaseResponse(
            success=True,
            sessionId=session_id,
            case=patient_case,
            symptoms=symptoms[:300] + "...",
            sources=formatted_sources[:3],
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Error in start_case: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/evaluate", response_model=EvaluateResponse, dependencies=[Depends(verify_api_key)])
async def evaluate_diagnosis(request: EvaluateRequest):
    """
    Nhận câu trả lời user, so sánh với đáp án chuẩn đã có trong session
    """
    try:
        session_id = request.sessionId
        diagnosis = request.diagnosis

        if not session_id:
            raise HTTPException(status_code=400, detail="Session ID required")

        session_data = session_store.get(session_id)
        if session_data is None:
            raise HTTPException(status_code=400, detail="Invalid or expired session")

        disease = session_data['disease']
        patient_case = session_data['case']
        standard_answer = session_data['standard']

        print(f"[INFO] Evaluating diagnosis for: {disease}")
        print(f"[INFO] Session ID: {session_id}")
        print(f"[INFO] User diagnosis: {diagnosis.dict()}")

        # Format user’s answer
        user_answer = f"""
CHẨN ĐOÁN:
- Lâm sàng: {diagnosis.clinical or 'Không có'}
- Cận lâm sàng: {diagnosis.paraclinical or 'Không có'}
- Chẩn đoán xác định: {diagnosis.definitiveDiagnosis or 'Không có'}
- Chẩn đoán phân biệt: {diagnosis.differentialDiagnosis or 'Không có'}

KẾ HOẠCH ĐIỀU TRỊ:
- Cách điều trị: {diagnosis.treatment or 'Không có'}
- Thuốc: {diagnosis.medication or 'Không có'}
"""
        print(f"[INFO] Formatted user answer (first 300 chars): {user_answer[:300]}...")

        # Run Groq evaluation (blocking I/O — executed off the event loop)
        print("[INFO] Step 1: Evaluating with Groq...")
        loop = asyncio.get_running_loop()
        evaluation_result = await loop.run_in_executor(
            None, evaluator.detailed_evaluation, user_answer, standard_answer
        )
        print(f"[INFO] Evaluation result (first 500 chars): {evaluation_result[:500]}...")

        # Parse JSON from evaluation
        print("[INFO] Step 2: Parsing JSON evaluation...")
        try:
            import json as _json
            eval_text = evaluation_result.strip()
            if eval_text.startswith('```'):
                lines = eval_text.split('\n')
                eval_text = '\n'.join(lines[1:-1]) if len(lines) > 2 else eval_text
                if eval_text.startswith('json'):
                    eval_text = eval_text[4:].strip()
            evaluation_obj = _json.loads(eval_text)
            print(f"[INFO] Successfully parsed JSON")
        except Exception as parse_error:
            print(f"[ERROR] Failed to parse JSON: {parse_error}")
            evaluation_obj = {
                'evaluation_text': evaluation_result,
                'diem_so': 'N/A',
                'diem_manh': [],
                'diem_yeu': ['Không thể parse JSON từ đánh giá'],
                'da_co': [],
                'thieu': [],
                'dien_giai': evaluation_result,
                'nhan_xet_tong_quan': 'Lỗi parse JSON'
            }

        # Sources are already pre-formatted plain dicts (stored in session)
        formatted_sources = session_data.get('sources', [])[:3]

        print("[INFO] Step 3: Formatting response...")
        return EvaluateResponse(
            success=True,
            case=patient_case,
            standardAnswer={
                "content": standard_answer,
                "disease": disease
            },
            evaluation=evaluation_obj,
            sources=formatted_sources
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Error in evaluate: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == '__main__':
    print("[*] Starting FastAPI Server...")
    print(f"[*] Server: http://localhost:8001")
    print(f"[*] Docs:   http://localhost:8001/docs")
    api_key_status = "configured" if Config.GROQ_API_KEY_1 else "NOT SET (set GROQ_API_KEY_1 in .env)"
    print(f"[*] Groq Key status: {api_key_status}")
    cors_status = "restricted" if ALLOWED_ORIGINS != ["*"] else "OPEN (*)"
    print(f"[*] CORS origins ({cors_status}): {ALLOWED_ORIGINS}")
    auth_status = "enabled" if _API_SECRET_KEY else "disabled (set API_SECRET_KEY to enable)"  
    print(f"[*] API auth: {auth_status}")
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8001")),
        log_level="info",
        reload=False
    )
