---
title: MedChat Backend
emoji: 🏥
colorFrom: blue
colorTo: green
sdk: docker
pinned: false
app_port: 7860
---

# MedChat RAG Backend

FastAPI backend for MedChat — a Vietnamese pediatric medical training assistant.

## Endpoints

- `GET /api/health` — health check
- `GET /api/diseases` — list diseases
- `POST /api/start-case` — generate patient case
- `POST /api/evaluate` — evaluate diagnosis
