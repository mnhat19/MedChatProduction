from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from embeddings import EmbeddingsManager
from typing import List
from pathlib import Path
import json
# pymongo is only needed for save_documents(); imported lazily below

from data_loader import DataLoader

class VectorStoreManager:
    def __init__(self):
        self.embeddings_manager = EmbeddingsManager()
        self.embeddings = self.embeddings_manager.get_embeddings() #  Chứa model embedding từ class EmbeddingsManager
        self.vector_store = None
        # Use relative path from current file location
        current_dir = Path(__file__).parent.parent  # Go up to rag_project folder
        self.cache_dir = current_dir / "faiss_cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)   

        self.load_faiss_cache() 

    def load_faiss_cache(self):
        """LOAD FAISS 0.1s"""
        index_path = self.cache_dir / "faiss_index"
        if index_path.exists():
            print(" LOADING FAISS CACHE...")
            self.vector_store = FAISS.load_local(
                str(index_path), 
                self.embeddings, 
                allow_dangerous_deserialization=True
            )
            print(f"LOADED {len(self.vector_store.docstore._dict)} chunks!")
            return True
        return False

    def build_and_cache(self, docs):
        """EMBED + SAVE"""
        #  FIX: Chỉ check 1 lần
        if self.vector_store is not None:  # Đã load/cache → skip
            return
        
        print(f" Embedding {len(docs)} chunks...")
        self.vector_store = FAISS.from_documents(docs, self.embeddings)
        
        # SAVE CACHE
        index_path = self.cache_dir / "faiss_index"
        self.vector_store.save_local(str(index_path))
        print(f"SAVED FAISS: {index_path}")


    # Hàm này truyền all_docs (List[Document] từ class DataLoader để embedding
    def build_from_docs(self, docs: List[Document]):
        """Xây dựng FAISS từ list chunks""" 

        """
        self.vector_store CHÍNH LÀ nơi lưu trữ:

            + Vector embedding (dạng số) của từng Document
            + Nội dung gốc (page_content)
            + Metadata (source_file, chunk_id, title, …)
            + Chỉ mục FAISS để tìm kiếm nhanh theo độ giống (cosine / L2)
        """

        self.vector_store = FAISS.from_documents(docs, self.embeddings)
        print(f"FAISS built with {len(docs)} medical chunks indexed!")
    
    def get_retriever(self, k: int = 3):
        """Trả về retriever với k docs"""
        if self.vector_store is None:
            raise ValueError("Vector store not built. Call build_from_docs first.")
        return self.vector_store.as_retriever(search_kwargs={"k": k})  
    
    def save_documents(self, docs):
        from pymongo import MongoClient  # optional dependency
        output_dir = Path(__file__).parent.parent / "store"
        output_dir.mkdir(parents=True, exist_ok=True)

        records = []
        for i, doc in enumerate(docs):
            records.append({
                "doc_id": f"doc_{i}",
                "page_content": doc.page_content,
                "metadata": doc.metadata
            })

        #  JSON
        with open(output_dir / "documents.json", "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False, indent=2)

        #  Mongo
        client = MongoClient("mongodb://localhost:27017/")
        col = client["medchat"]["store"]
        col.delete_many({})
        col.insert_many(records)
        client.close()

        print(f"Saved {len(records)} documents") 
    
    def save_embeddings(self, docs):

        texts = [doc.page_content for doc in docs]
        vectors = self.embeddings.embed_documents(texts)

        output_dir = Path(r"D:\Storage\rag_project\store")

        records = []
        for i, vec in enumerate(vectors):
            records.append({
                "doc_id": f"doc_{i}",
                "embedding": vec
            })

        #  JSON
        with open(output_dir / "embeddings.json", "w", encoding="utf-8") as f:
            json.dump(records, f)

        #  Mongo
        client = MongoClient("mongodb://localhost:27017/")
        col = client["medchat"]["embeddings"]
        col.delete_many({})
        col.insert_many(records)
        client.close()

        print(f" Saved {len(records)} embeddings")


# TEST: python vector_store.py
if __name__ == "__main__":
    print("TEST VECTOR STORE...")

    # docs sample     
    docs = [
        Document(
            page_content="Sốt ở trẻ em là tình trạng thân nhiệt tăng trên 38 độ.",
            metadata={"title": "Sốt trẻ em"}
        ),
        Document(
            page_content="Tiêu chảy cấp ở trẻ thường do virus hoặc vi khuẩn.",
            metadata={"title": "Tiêu chảy"}
        ),
        Document(
            page_content="Gãy xương tay cần được cố định và đưa đến cơ sở y tế.",
            metadata={"title": "Chấn thương"}
        ),
    ]

    vs = VectorStoreManager()
    vs.build_from_docs(docs)
    print(f"Đã build xong docs")

    retriever = vs.get_retriever(k=2)
    results = retriever.get_relevant_documents("vi khuẩn")

    print("\n KẾT QUẢ TRUY XUẤT:")
    for i, doc in enumerate(results):
        print(f"{i+1}. {doc.metadata['title']} | {doc.page_content[:60]}...")

    print("\n VECTOR STORE OK!") 

    all_docs = DataLoader.load_all_chunks()

    vs.build_from_docs(docs)
    
    print(f"Đã build xong all_docs")
    vs.save_documents(all_docs)
    vs.save_embeddings(all_docs)

    print("\n HOÀN THÀNH LƯU DOCUMENT VÀ EMBEDING HOÀN TẤT")