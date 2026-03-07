"""
GroqKeyManager — round-robin key rotation with immediate failover on 429.

Usage:
    mgr = GroqKeyManager([KEY_1, KEY_2])
    key = mgr.current()           # get current key
    key = mgr.rotate()            # advance to next key (call on 429)
    llm = mgr.build_llm(model)    # ChatGroq with current key
"""
import threading
import time
import logging
from typing import List

from langchain_groq import ChatGroq

logger = logging.getLogger(__name__)


class GroqKeyManager:
    """Thread-safe round-robin Groq API key manager."""

    def __init__(self, keys: List[str], model: str = "llama-3.3-70b-versatile"):
        self._keys = [k.strip() for k in keys if k and k.strip()]
        if not self._keys:
            raise ValueError("GroqKeyManager: no valid API keys provided")
        self._model = model
        self._idx = 0
        self._lock = threading.Lock()
        # per-key cooldown tracking: key → expiry timestamp
        self._cooldown: dict[str, float] = {}
        logger.info(f"[KeyManager] {len(self._keys)} Groq key(s) loaded, model={model}")

    def current(self) -> str:
        with self._lock:
            return self._keys[self._idx % len(self._keys)]

    def rotate(self) -> str:
        """Advance to next available (non-cooled-down) key. Returns the new key."""
        with self._lock:
            now = time.time()
            for _ in range(len(self._keys)):
                self._idx = (self._idx + 1) % len(self._keys)
                key = self._keys[self._idx]
                if now >= self._cooldown.get(key, 0):
                    logger.warning(f"[KeyManager] Rotated to key index {self._idx}")
                    return key
            # all keys on cooldown — return current and let tenacity wait
            logger.warning("[KeyManager] All keys on cooldown, returning current key")
            return self._keys[self._idx % len(self._keys)]

    def mark_rate_limited(self, key: str, cooldown_secs: int = 62):
        """Mark a key as rate-limited for cooldown_secs seconds."""
        with self._lock:
            self._cooldown[key] = time.time() + cooldown_secs
            logger.warning(f"[KeyManager] Key ...{key[-6:]} cooled down for {cooldown_secs}s")

    def build_llm(self, temperature: float = 0) -> ChatGroq:
        """Return a ChatGroq instance using the current key."""
        return ChatGroq(
            model=self._model,
            api_key=self.current(),
            temperature=temperature,
            max_tokens=800,   # cap output tokens to save quota
        )
