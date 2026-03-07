"""
SQLite-backed session store with TTL for RAG sessions.
Replaces the in-memory dict to persist sessions across server restarts
and prevent unbounded memory growth.
"""
import sqlite3
import json
import time
from pathlib import Path
from typing import Optional, Dict, Any

SESSION_TTL_SECONDS = 24 * 60 * 60  # 24 hours


class SessionStore:
    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            db_path = str(Path(__file__).parent.parent / "sessions.db")
        self.db_path = db_path
        self._init_db()
        print(f"[SessionStore] SQLite store at: {self.db_path}")

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")  # Better concurrent read performance
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._get_conn() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    data       TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                )
                """
            )
            conn.commit()

    def get(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Return session data or None if not found / expired."""
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT data, updated_at FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()

        if row is None:
            return None

        if time.time() - row["updated_at"] > SESSION_TTL_SECONDS:
            self.delete(session_id)
            return None

        return json.loads(row["data"])

    def set(self, session_id: str, data: Dict[str, Any]):
        """Persist or update a session (all values must be JSON-serialisable)."""
        now = time.time()
        data_json = json.dumps(data, ensure_ascii=False)
        with self._get_conn() as conn:
            conn.execute(
                """
                INSERT INTO sessions (session_id, data, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE
                    SET data = excluded.data, updated_at = excluded.updated_at
                """,
                (session_id, data_json, now, now),
            )
            conn.commit()

    def delete(self, session_id: str):
        with self._get_conn() as conn:
            conn.execute(
                "DELETE FROM sessions WHERE session_id = ?", (session_id,)
            )
            conn.commit()

    def cleanup_expired(self) -> int:
        """Delete all sessions older than SESSION_TTL_SECONDS. Returns count deleted."""
        cutoff = time.time() - SESSION_TTL_SECONDS
        with self._get_conn() as conn:
            cur = conn.execute(
                "DELETE FROM sessions WHERE updated_at < ?", (cutoff,)
            )
            conn.commit()
            deleted = cur.rowcount
        if deleted:
            print(f"[SessionStore] Cleaned up {deleted} expired session(s)")
        return deleted

    def cleanup_expired(self) -> int:
        """Remove sessions older than TTL. Returns number of rows deleted."""
        cutoff = time.time() - SESSION_TTL_SECONDS
        with self._get_conn() as conn:
            deleted = conn.execute(
                "DELETE FROM sessions WHERE updated_at < ?", (cutoff,)
            ).rowcount
            conn.commit()
        if deleted:
            print(f"[SessionStore] Cleaned up {deleted} expired session(s)")
        return deleted
