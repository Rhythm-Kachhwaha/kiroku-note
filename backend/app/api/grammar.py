from fastapi import APIRouter

from app.schemas import (
    GrammarAnalyzeRequest, GrammarAnalyzeResponse, GrammarSetupCheckResponse,
)
from app.services.grammar_service import GrammarService

grammar_router = APIRouter(prefix="/api/grammar", tags=["grammar"])
_service = GrammarService()


@grammar_router.post("/analyze", response_model=GrammarAnalyzeResponse)
def analyze_grammar(request: GrammarAnalyzeRequest) -> GrammarAnalyzeResponse:
    return _service.analyze(request.sentence, request.learner_level)


@grammar_router.post("/setup-check", response_model=GrammarSetupCheckResponse)
def grammar_setup_check() -> GrammarSetupCheckResponse:
    return _service.setup_check()
