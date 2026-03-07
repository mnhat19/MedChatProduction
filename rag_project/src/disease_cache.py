"""
Disease-level result cache — avoids repeating RAG+LLM queries for the same disease.

Stores (symptoms_text, standard_text, sources_json) per disease in SQLite.
TTL: 7 days (medical knowledge stable; rebuild only after data update).

Impact:
  - Cold (first request for a disease):  3 LLM calls + FAISS search
  - Warm (subsequent requests):          0 LLM calls, 0 FAISS search → ~5 s → <0.1 s
"""
import sqlite3
import json
import time
import logging
from pathlib import Path
from typing import Optional, Tuple, List, Dict

logger = logging.getLogger(__name__)

TTL_SECONDS = 7 * 24 * 60 * 60   # 7 days


class DiseaseCache:
    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            db_path = str(Path(__file__).parent.parent / "disease_cache.db")
        self.db_path = db_path
        self._init_db()
        logger.info(f"[DiseaseCache] SQLite cache at: {self.db_path}")

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._conn() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS disease_cache (
                    disease    TEXT PRIMARY KEY,
                    symptoms   TEXT NOT NULL,
                    standard   TEXT NOT NULL,
                    sources    TEXT NOT NULL DEFAULT '[]',
                    cached_at  REAL NOT NULL
                )
            """)
            c.commit()

    # ── read ──────────────────────────────────────────────────────────────────
    def get(self, disease: str) -> Optional[Dict]:
        """Return cached {symptoms, standard, sources} or None if missing/expired."""
        with self._conn() as c:
            row = c.execute(
                "SELECT symptoms, standard, sources, cached_at FROM disease_cache WHERE disease = ?",
                (disease,)
            ).fetchone()

        if row is None:
            return None

        age = time.time() - row["cached_at"]
        if age > TTL_SECONDS:
            self.invalidate(disease)
            logger.info(f"[DiseaseCache] Cache expired for '{disease}' ({age/3600:.1f}h old)")
            return None

        logger.info(f"[DiseaseCache] Cache HIT for '{disease}' ({age/3600:.1f}h old)")
        return {
            "symptoms": row["symptoms"],
            "standard": row["standard"],
            "sources":  json.loads(row["sources"]),
        }

    # ── write ─────────────────────────────────────────────────────────────────
    def set(self, disease: str, symptoms: str, standard: str, sources: List[Dict]):
        """Cache symptoms + standard for a disease."""
        now = time.time()
        sources_json = json.dumps(sources, ensure_ascii=False)
        with self._conn() as c:
            c.execute("""
                INSERT INTO disease_cache (disease, symptoms, standard, sources, cached_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(disease) DO UPDATE
                    SET symptoms=excluded.symptoms,
                        standard=excluded.standard,
                        sources=excluded.sources,
                        cached_at=excluded.cached_at
            """, (disease, symptoms, standard, sources_json, now))
            c.commit()
        logger.info(f"[DiseaseCache] Cached '{disease}'")

    # ── management ────────────────────────────────────────────────────────────
    def invalidate(self, disease: str):
        with self._conn() as c:
            c.execute("DELETE FROM disease_cache WHERE disease = ?", (disease,))
            c.commit()

    def invalidate_all(self):
        with self._conn() as c:
            c.execute("DELETE FROM disease_cache")
            c.commit()
        logger.info("[DiseaseCache] All entries invalidated")

    def stats(self) -> Dict:
        with self._conn() as c:
            total = c.execute("SELECT COUNT(*) FROM disease_cache").fetchone()[0]
            fresh = c.execute(
                "SELECT COUNT(*) FROM disease_cache WHERE cached_at > ?",
                (time.time() - TTL_SECONDS,)
            ).fetchone()[0]
        return {"total": total, "fresh": fresh, "expired": total - fresh}
