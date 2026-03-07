from langchain_community.vectorstores import FAISS
import re

# Vietnamese stop words — high-frequency words that corrupt keyword ranking signals
VIETNAMESE_STOPWORDS = {
    'và', 'là', 'của', 'có', 'cho', 'với', 'các', 'được', 'trong',
    'đến', 'khi', 'này', 'bằng', 'theo', 'một', 'những', 'từ', 'hay',
    'như', 'hoặc', 'về', 'tại', 'trên', 'sau', 'trước', 'cùng', 'để',
    'không', 'cần', 'phải', 'nên', 'thể', 'vào', 'ra', 'đây', 'đó',
    'nào', 'mà', 'thì', 'sẽ', 'đã', 'còn', 'vẫn', 'rất', 'nhiều',
    'đặc', 'biệt', 'thêm', 'khác', 'tất', 'cả', 'nếu', 'bởi', 'vì',
}


class HybridRetriever:
    def __init__(self, vectorstore):
        self.vs = vectorstore

    def keyword_search(self, query, k=5):
        """Exact keyword matching with Vietnamese stop-word filtering - PRIORITY 1"""
        keywords = [
            w for w in re.findall(r'\b\w{3,}\b', query.lower())
            if w not in VIETNAMESE_STOPWORDS
        ]
        if not keywords:
            return []

        scored_docs = []
        for doc_id, doc in self.vs.docstore._dict.items():
            content_lower = doc.page_content.lower()
            title_lower = doc.metadata.get('chunk_title', '').lower()

            # Title match scores 2x; content match scores 1x
            score = sum(
                2 if kw in title_lower else 1
                for kw in keywords
                if kw in content_lower or kw in title_lower
            )
            if score > 0:
                scored_docs.append((score, doc))

        scored_docs.sort(reverse=True, key=lambda x: x[0])
        return [doc for _, doc in scored_docs[:k]]

    def hybrid_search(self, query, k=3):
        """KEYWORD FIRST → Semantic backup"""
        keyword_docs = self.keyword_search(query, k=k * 2)

        if keyword_docs:
            print(f" KEYWORD HIT: {len(keyword_docs)} docs")
            return keyword_docs[:k]

        print(" Semantic fallback...")
        semantic_docs = self.vs.similarity_search(query, k=k)
        return semantic_docs
