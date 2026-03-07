from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception
from langchain_core.prompts import PromptTemplate
from config import Config
from key_manager import GroqKeyManager
from hybrid_retriever import HybridRetriever
from vector_store import VectorStoreManager

# Shared key manager -- single instance reused across all RAGChain objects
_KEY_MANAGER = None


def get_key_manager():
    global _KEY_MANAGER
    if _KEY_MANAGER is None:
        _KEY_MANAGER = GroqKeyManager(
            keys=[Config.GROQ_API_KEY_1, Config.GROQ_API_KEY_2],
            model=Config.GROQ_MODEL,
        )
    return _KEY_MANAGER


def _is_rate_limit(exc):
    msg = str(exc).lower()
    return "429" in msg or "quota" in msg or "rate limit" in msg or "ratelimit" in msg


class RAGChain:
    def __init__(self, vector_store_manager):
        self._km = get_key_manager()
        self.vectorstore = vector_store_manager.vector_store
        self.retriever = HybridRetriever(self.vectorstore)
        self.prompt_template = PromptTemplate(
            input_variables=["context", "question"],
            template="Tài liệu y khoa:\n{context}\n\nCâu hỏi: {question}\n\nTrả lời ngắn gọn, chọn lọc thông tin quan trọng nhất từ tài liệu (tối đa 200 từ):"
        )

    def query(self, question):
        sources = self.retriever.hybrid_search(question, k=3)
        ranked = self.rerank_sources(sources, question)
        context = self.build_context(ranked)
        prompt = self.prompt_template.format(context=context, question=question)

        @retry(
            retry=retry_if_exception(_is_rate_limit),
            wait=wait_exponential(multiplier=1, min=5, max=30),
            stop=stop_after_attempt(4),
            reraise=True,
        )
        def _invoke():
            try:
                llm = self._km.build_llm(temperature=0)
                return llm.invoke([prompt])
            except Exception as exc:
                if _is_rate_limit(exc):
                    self._km.mark_rate_limited(self._km.current())
                    self._km.rotate()
                raise

        result = _invoke()
        return result.content, ranked

    def rerank_sources(self, sources, question):
        keywords = question.lower().split()
        def score(doc):
            text = doc.page_content.lower() + doc.metadata.get("chunk_title", "").lower()
            return sum(1 for kw in keywords if kw in text)
        return sorted(sources, key=score, reverse=True)

    def build_context(self, sources):
        parts = []
        for i, doc in enumerate(sources[:3]):
            meta = f"[{i+1}] {doc.metadata.get('source_file','?')} | {doc.metadata.get('chunk_title','?')}"
            content = doc.page_content[:600]
            parts.append(f"{meta}\n{content}")
        return "\n\n".join(parts)
