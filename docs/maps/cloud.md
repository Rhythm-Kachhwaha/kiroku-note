# Cloud queue

1. **Entry point** — `kiroku_cloud_queue/server.py` (API) and `worker.py` (polling/processing).
2. **Core logic** — `queue_adapter.py`, `queue_db.py`, `queue_store.py`, `postgres_store.py`, `enrichment.py`, and `anki_mirror.py`.
3. **API/integration** — cloud clients use `kiroku_client.py`; the local backend imports the queue through an explicit path setup in `main.py`.
4. **Data/configuration** — `kiroku_cloud_queue/*.db`, `.env.example`, `postgres_schema.sql`, `render.yaml`, `Dockerfile`, and deployment docs.
5. **Tests** — `kiroku_cloud_queue/tests/` with its own requirements and `pytest.ini`.
6. **Build/runtime dependencies** — this remains a separately deployable component; do not make it depend on desktop GUI libraries or extension files.
