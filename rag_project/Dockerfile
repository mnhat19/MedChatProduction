# ── HuggingFace Spaces compatible Dockerfile ──────────────────────────────
# Port MUST be 7860 for HF Spaces.
# Runs as user 1000 (HF requirement).

FROM python:3.10-slim

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl git \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (required by HF Spaces)
RUN useradd -m -u 1000 appuser

WORKDIR /app

# Install Python deps first (better layer caching)
COPY requirements_api.txt .
RUN pip install --no-cache-dir -r requirements_api.txt

# Copy application files
COPY . .

# Set ownership
RUN chown -R appuser:appuser /app

USER appuser

# Pre-build FAISS index at image build time (bakes the 4.4 MB index in)
# Sentence-transformer model is downloaded here and cached in /home/appuser/.cache
RUN python src/build_faiss.py

# Environment defaults (override via HF Space secrets)
ENV GROQ_API_KEY_1=""
ENV GROQ_API_KEY_2=""
ENV GROQ_MODEL="llama-3.3-70b-versatile"
ENV ALLOWED_ORIGINS="*"
ENV PORT=7860

# Expose HF Spaces port
EXPOSE 7860

CMD ["python", "api_server_fastapi.py"]
