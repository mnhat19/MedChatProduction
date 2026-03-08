from langchain_huggingface import HuggingFaceEmbeddings
from config import Config 
from numpy import dot
from numpy.linalg import norm

class EmbeddingsManager:
    # Khởi tạo model embedding từ cofig ngay khi gọi class
    def __init__(self):
        import os
        # Use cached model; never call the network (model is baked into Docker image)
        local_only = os.getenv("TRANSFORMERS_OFFLINE", "0") == "1" or \
                     os.getenv("HF_HUB_OFFLINE", "0") == "1"
        self.embeddings = HuggingFaceEmbeddings(
            model_name=Config.EMBEDDING_MODEL,
            model_kwargs={"local_files_only": local_only},
        )
    
    def get_embeddings(self):
        return self.embeddings 

# Code thêm cái này xíu hiểu hơn bản chất so sánh vector embed
def cosine(a, b):
    return dot(a, b) / (norm(a) * norm(b))

# TEST: python embeddings.py
if __name__ == "__main__":
    print("Loading embedding model...")
    em = EmbeddingsManager()
    embeddings = em.get_embeddings()

    text = "Sốt ở trẻ em là tình trạng thân nhiệt tăng."
    vec = embeddings.embed_query(text)

    print("Vector length:", len(vec))
    print("First 5 values:", vec[:5])  

     # ---- Test 2: cosine similarity ----
    v1 = embeddings.embed_query("Sốt ở trẻ em")
    v2 = embeddings.embed_query("Trẻ bị sốt cao")
    v3 = embeddings.embed_query("Gãy xương tay")

    print("\n COSINE SIMILARITY TEST")
    print("v1 ↔ v2 (gần nghĩa):", cosine(v1, v2))
    print("v1 ↔ v3 (khác nghĩa):", cosine(v1, v3))

    """ 
     OUTPUT VÀ EXPLAIN DỄ HIỂU: 
     1. OUTPUT: 
     Vector length: 384
     First 5 values: [-0.02630099654197693, 0.01091383583843708, 0.0058159008622169495, -0.05811420455574989, -0.051191169768571854]
    
     2. EXPLAIN 
    - Là tọa độ ngữ nghĩa của câu

    - Không có ý nghĩa đơn lẻ

    - Chỉ có ý nghĩa khi so sánh với vector khác
        
        v1 = embed("Sốt ở trẻ em")
        v2 = embed("Trẻ bị sốt cao")
        v3 = embed("Gãy xương tay") 

       => v1 ≈ v2   (gần)
          v1 ≠ v3   (xa)
        
    => FAISS dùng cosine similarity / L2 distance để tìm câu gần nghĩa nhất

    """


