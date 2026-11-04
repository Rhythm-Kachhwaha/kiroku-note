# Journey map

1. **Backend routes** — `backend/app/api/journey.py`, `backend/app/schemas_journey.py`.
2. **Services** — `backend/app/services/journey_service.py`, `backend/app/services/gamification.py`.
3. **Database models** — `backend/app/models/journey.py`, SQLite user journey state.
4. **Desktop views** — `desktop/src/ui/views/journey.js`, `desktop/src/ui/styles/views/journey.css`.
5. **UI components** — tactile milestone badges, streak tracker, level progress cards.
6. **Tests** — backend: `pytest backend/tests/test_journey_*.py -q`; desktop: `node --test desktop/tests/test_journey_*.test.js`.
