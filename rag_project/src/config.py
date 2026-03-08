import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Project root directory resolved relative to this file (rag_project/)
    BASE_DIR = Path(__file__).parent.parent
    DATA_DIR = BASE_DIR / "data"
    CHUNK_FILES = [
        str(DATA_DIR / "BoYTe200_v3.json"),
        str(DATA_DIR / "NHIKHOA2.json"),
        str(DATA_DIR / "PHACDODIEUTRI_2016.json"),
    ]

    # EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
    # EMBEDDING_MODEL = "bkai-foundation-models/vietnamese-bi-encoder"
    EMBEDDING_MODEL = "VoVanPhuc/sup-SimCSE-VietNamese-phobert-base"

    # Groq API keys (set in rag_project/.env)
    GROQ_API_KEY_1 = os.getenv('GROQ_API_KEY_1', '')
    GROQ_API_KEY_2 = os.getenv('GROQ_API_KEY_2', '')
    GROQ_API_KEY_3 = os.getenv('GROQ_API_KEY_3', '')

    # Keep Google key in case frontend/other services need it
    GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY', '')

    GROQ_MODEL = os.getenv('GROQ_MODEL', 'llama-3.3-70b-versatile')
    LLM_MODEL = GROQ_MODEL          # alias used in older code
    K_RETRIEVE = 3
    TEMPERATURE = 0
