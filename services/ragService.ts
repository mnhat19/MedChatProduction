/**
 * RAG API Service
 * Connects React frontend to Python RAG backend
 */

// Use VITE_RAG_API_URL for production deploy; falls back to localhost for local dev
const RAG_API_URL = (import.meta.env.VITE_RAG_API_URL ?? 'http://localhost:8001') + '/api';

export interface Disease {
  id: string;
  name: string;
  source: string;
  category: string;
  sections: string[];
}

export interface CategoryCount {
  name: string;
  count: number;
}

export interface QueryResult {
  answer: string;
  sources: {
    content: string;
    chunk_title: string;
    section_title: string;
    source_file: string;
  }[];
}

export interface GeneratedCase {
  case: string;
  symptoms: string;
  disease: string;
}

export interface EvaluationResult {
  case: string;
  standard: string;
  evaluation: string;
  sources: {
    file: string;
    title: string;
    section: string;
  }[];
}

class RagService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = RAG_API_URL;
  }

  /**
   * Check if RAG API is available
   */
  async checkHealth(): Promise<{
    status: string;
    message: string;
    embedding_model: string;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      if (!response.ok) throw new Error('API not available');
      return await response.json();
    } catch (error) {
      console.error('RAG API health check failed:', error);
      throw error;
    }
  }

  /**
   * Get all diseases from RAG database
   */
  async getDiseases(category?: string, search?: string): Promise<Disease[]> {
    console.log('[ragService] getDiseases called with:', { category, search });
    const params = new URLSearchParams();
    if (category && category !== 'all') params.append('category', category);
    if (search) params.append('search', search);
    
    const url = `${this.baseUrl}/diseases${params.toString() ? '?' + params.toString() : ''}`;
    console.log('[ragService] Fetching URL:', url);
    
    try {
      const response = await fetch(url);
      console.log('[ragService] Response status:', response.status, response.statusText);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch diseases: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('[ragService] Response data keys:', Object.keys(data));
      console.log('[ragService] diseases count:', data.diseases?.length);
      
      return data.diseases || [];
    } catch (error) {
      console.error('[ragService] getDiseases error:', error);
      throw error;
    }
  }

  /**
   * Get disease categories
   */
  async getCategories(): Promise<CategoryCount[]> {
    const response = await fetch(`${this.baseUrl}/categories`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch categories');
    }
    
    return await response.json();
  }

  /**
   * Query the RAG knowledge base
   */
  async queryKnowledge(question: string): Promise<QueryResult> {
    const response = await fetch(`${this.baseUrl}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, k: 3 }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to query knowledge base');
    }
    
    return await response.json();
  }

  /**
   * Generate a patient case for training
   */
  async generateCase(disease: string, sessionId: string): Promise<GeneratedCase & { sessionId: string; sources: any[] }> {
    console.log('[ragService] generateCase called with:', { disease, sessionId });
    const url = `${this.baseUrl}/start-case`;
    console.log('[ragService] POST URL:', url);
    
    try {
      // Create AbortController with 180s timeout for RAG + Gemini processing
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000); // 180 seconds (3 minutes)
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disease, sessionId }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      console.log('[ragService] generateCase response:', response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[ragService] Error response:', errorText);
        throw new Error(`Failed to generate case: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('[ragService] generateCase data:', data);
      
      return {
        case: data.case,
        symptoms: data.symptoms,
        disease: disease,
        sessionId: data.sessionId,
        sources: data.sources || []
      };
    } catch (error) {
      console.error('[ragService] generateCase error:', error);
      throw error;
    }
  }

  /**
   * Evaluate doctor's answer against RAG knowledge
   */
  async evaluateAnswer(
    sessionId: string,
    diagnosis: {
      clinical: string;
      paraclinical: string;
      definitiveDiagnosis: string;
      differentialDiagnosis: string;
      treatment: string;
      medication: string;
    }
  ): Promise<EvaluationResult> {
    // Create AbortController with 180s timeout for RAG + Gemini evaluation
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);
    
    const response = await fetch(`${this.baseUrl}/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, diagnosis }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error('Failed to evaluate answer');
    }
    
    const data = await response.json();
    console.log('[ragService] Evaluate response:', data);
    
    return {
      case: data.case,
      standard: typeof data.standardAnswer === 'object' 
        ? data.standardAnswer.content 
        : data.standardAnswer,
      evaluation: typeof data.evaluation === 'string'
        ? data.evaluation
        : JSON.stringify(data.evaluation, null, 2),
      sources: data.sources || []
    };
  }

  /**
   * Get a specific disease by ID
   */
  async getDisease(diseaseId: string): Promise<Disease> {
    const response = await fetch(`${this.baseUrl}/diseases/${diseaseId}`);
    
    if (!response.ok) {
      throw new Error('Disease not found');
    }
    
    return await response.json();
  }
}

// Export singleton instance
export const ragService = new RagService();
