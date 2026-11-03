# LLM and secrets

1. **Entry point** — `/api/llm/*` routes currently live in `backend/app/main.py`.
2. **Core logic** — `backend/app/services/llm_service.py` implements the provider-neutral request flow and Groq, Gemini, Ollama and compatible providers; prompt construction is in the same service.
3. **API/integration** — `backend/app/schemas.py`, `main.py`, and the Side Panel settings/ask controllers configure and invoke it.
4. **Data/configuration** — `backend/app/config.py` stores non-secret settings in the user data directory; `backend/app/services/secret_store.py` owns encrypted Windows DPAPI-backed secret storage.
5. **Tests** — `backend/tests/test_llm_*.py` and `test_secret_store.py`.
6. **Build/runtime dependencies** — preserve provider timeouts, offline `none`/Ollama operation, encrypted secrets, and redaction when changing configuration or packaging.
