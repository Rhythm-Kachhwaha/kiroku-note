"""Tests for the LLM Assistant Core Service, Providers, and FastAPI Endpoints."""
import json
import socket
import urllib.error
import urllib.request
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.config import (
    get_llm_api_key,
    get_llm_model,
    get_llm_ollama_url,
    get_llm_provider,
    is_llm_configured,
)
from app.main import app
from app.schemas import LLMChatMessage, LLMRequest, LLMResponse, LLMStatusResponse
from app.services.llm_service import (
    GeminiProvider,
    GroqProvider,
    LLMAPIError,
    LLMConnectionError,
    LLMNotConfiguredError,
    LLMService,
    LLMTimeoutError,
    NoneProvider,
    OllamaProvider,
    get_llm_service,
)


@pytest.fixture
def client():
    return TestClient(app)


def _make_http_response(payload: dict, status: int = 200):
    """Helper to create a mock urllib HTTP response object."""
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps(payload).encode("utf-8")
    mock_resp.status = status
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = None
    return mock_resp


# ============================================================================
# 1. Configuration Resolution Tests
# ============================================================================

def test_llm_config_defaults():
    env = {}
    assert get_llm_provider(env) == "none"
    assert get_llm_api_key(env) is None
    assert get_llm_ollama_url(env) == "http://localhost:11434"
    assert get_llm_model(env) is None
    assert is_llm_configured(env) is False


def test_llm_config_overrides():
    env = {
        "KIROKU_LLM_PROVIDER": "GROQ",
        "KIROKU_LLM_API_KEY": "gsk_test123",
        "KIROKU_OLLAMA_URL": "http://192.168.1.100:11434",
        "KIROKU_LLM_MODEL": "custom-model-1",
    }
    assert get_llm_provider(env) == "groq"
    assert get_llm_api_key(env) == "gsk_test123"
    assert get_llm_ollama_url(env) == "http://192.168.1.100:11434"
    assert get_llm_model(env) == "custom-model-1"
    assert is_llm_configured(env) is True


def test_llm_config_is_configured_logic():
    # Groq needs api_key
    assert is_llm_configured({"KIROKU_LLM_PROVIDER": "groq"}) is False
    assert is_llm_configured({"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "key"}) is True

    # Gemini needs api_key
    assert is_llm_configured({"KIROKU_LLM_PROVIDER": "gemini"}) is False
    assert is_llm_configured({"KIROKU_LLM_PROVIDER": "gemini", "KIROKU_LLM_API_KEY": "key"}) is True

    # Ollama needs url (has default)
    assert is_llm_configured({"KIROKU_LLM_PROVIDER": "ollama"}) is True


# ============================================================================
# 2. NoneProvider & Unconfigured Status / Ask Tests
# ============================================================================

def test_none_provider_status(client):
    with patch.dict("os.environ", {"KIROKU_LLM_PROVIDER": "none"}, clear=True):
        resp = client.get("/api/llm/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["configured"] is False
        assert data["provider"] == "none"
        assert data["model"] is None


def test_none_provider_ask_returns_501(client):
    with patch.dict("os.environ", {"KIROKU_LLM_PROVIDER": "none"}, clear=True):
        payload = {
            "task": "translate",
            "text": "これはテストです。",
        }
        resp = client.post("/api/llm/ask", json=payload)
        assert resp.status_code == 501
        assert "not configured" in resp.json()["detail"].lower()


# ============================================================================
# 3. GroqProvider Mocked Tests
# ============================================================================

def test_groq_provider_ask_success(client):
    mock_groq_payload = {
        "choices": [
            {
                "message": {
                    "content": "This is a test."
                }
            }
        ]
    }
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "gsk_valid_key"},
        clear=True,
    ):
        with patch("urllib.request.urlopen", return_value=_make_http_response(mock_groq_payload)) as mock_urlopen:
            resp = client.post(
                "/api/llm/ask",
                json={"task": "translate", "text": "これはテストです。"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["result"] == "This is a test."
            assert data["provider"] == "groq"
            assert data["model"] == "llama-3.1-8b-instant"

            # Verify request headers and payload
            assert mock_urlopen.called
            req = mock_urlopen.call_args[0][0]
            assert req.full_url == "https://api.groq.com/openai/v1/chat/completions"
            assert req.headers["Authorization"] == "Bearer gsk_valid_key"
            req_body = json.loads(req.data.decode("utf-8"))
            assert req_body["model"] == "llama-3.1-8b-instant"
            assert any(m["role"] == "system" for m in req_body["messages"])
            assert req_body["messages"][-1]["content"] == "これはテストです。"


# ============================================================================
# 4. GeminiProvider Mocked Tests
# ============================================================================

def test_gemini_provider_ask_success(client):
    mock_gemini_payload = {
        "candidates": [
            {
                "content": {
                    "parts": [{"text": "The grammar pattern indicates a hypothesis."}]
                }
            }
        ]
    }
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "gemini", "KIROKU_LLM_API_KEY": "AIzaSyTestKey"},
        clear=True,
    ):
        with patch("urllib.request.urlopen", return_value=_make_http_response(mock_gemini_payload)) as mock_urlopen:
            resp = client.post(
                "/api/llm/ask",
                json={"task": "explain_grammar", "text": "雨が降れば、行きません。"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["result"] == "The grammar pattern indicates a hypothesis."
            assert data["provider"] == "gemini"
            assert data["model"] == "gemini-2.0-flash"

            assert mock_urlopen.called
            req = mock_urlopen.call_args[0][0]
            assert "gemini-2.0-flash:generateContent" in req.full_url
            assert "key=" not in req.full_url
            assert req.headers["X-goog-api-key"] == "AIzaSyTestKey" or req.headers.get("x-goog-api-key") == "AIzaSyTestKey"
            req_body = json.loads(req.data.decode("utf-8"))
            assert "contents" in req_body


# ============================================================================
# 5. OllamaProvider Mocked Tests
# ============================================================================

def test_ollama_provider_ask_success(client):
    mock_ollama_payload = {
        "message": {
            "role": "assistant",
            "content": "A mnemonic: imagine a tree with sun rays.",
        }
    }
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "ollama", "KIROKU_OLLAMA_URL": "http://127.0.0.1:11434"},
        clear=True,
    ):
        with patch("urllib.request.urlopen", return_value=_make_http_response(mock_ollama_payload)) as mock_urlopen:
            resp = client.post(
                "/api/llm/ask",
                json={
                    "task": "mnemonic",
                    "text": "木漏れ日",
                    "word": "木漏れ日",
                    "context": "sunlight filtering through trees",
                },
            )
            assert resp.status_code == 200
            data = resp.json()
            assert "mnemonic" in data["result"].lower()
            assert data["provider"] == "ollama"
            assert data["model"] == "qwen2.5:1.5b"

            assert mock_urlopen.called
            req = mock_urlopen.call_args[0][0]
            assert req.full_url == "http://127.0.0.1:11434/api/chat"
            req_body = json.loads(req.data.decode("utf-8"))
            assert req_body["model"] == "qwen2.5:1.5b"
            assert req_body["stream"] is False


# ============================================================================
# 6. Built-in Prompts & Tasks
# ============================================================================

def test_explain_sense_prompt(client):
    mock_groq_payload = {"choices": [{"message": {"content": "Sense 1 fits best."}}]}
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "key"},
        clear=True,
    ):
        with patch("urllib.request.urlopen", return_value=_make_http_response(mock_groq_payload)) as mock_urlopen:
            resp = client.post(
                "/api/llm/ask",
                json={
                    "task": "explain_sense",
                    "text": "彼は気を落とした。",
                    "word": "気",
                    "context": "1. spirit/mind, 2. atmosphere, 3. feeling",
                },
            )
            assert resp.status_code == 200
            req = mock_urlopen.call_args[0][0]
            req_body = json.loads(req.data.decode("utf-8"))
            prompt_content = req_body["messages"][-1]["content"]
            assert "気" in prompt_content
            assert "spirit/mind" in prompt_content


def test_answer_question_prompt_for_mcq_and_explanation(client):
    mock_groq_payload = {
        "choices": [
            {
                "message": {
                    "content": "Answer: 2 (食べたばかり). Explanation: 'ばかり' expresses that an action just finished."
                }
            }
        ]
    }
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "key"},
        clear=True,
    ):
        with patch("urllib.request.urlopen", return_value=_make_http_response(mock_groq_payload)) as mock_urlopen:
            resp = client.post(
                "/api/llm/ask",
                json={
                    "task": "answer_question",
                    "text": "今、ご飯を（　）ところです。\n1. 食べる\n2. 食べたばかり\n3. 食べている\n4. 食べよう",
                    "context": "JLPT N3 grammar practice",
                },
            )
            assert resp.status_code == 200
            data = resp.json()
            assert "Answer: 2" in data["result"]

            req = mock_urlopen.call_args[0][0]
            req_body = json.loads(req.data.decode("utf-8"))
            # System prompt must instruct answering questions, explaining why, and handling MCQs
            system_msg = next(m["content"] for m in req_body["messages"] if m["role"] == "system")
            assert "answer" in system_msg.lower()
            assert "explain" in system_msg.lower()


def test_chat_multi_turn_history(client):
    mock_groq_payload = {
        "choices": [
            {
                "message": {
                    "content": "Yes, 'ばかり' differs from 'ところ' because 'ところ' is about the exact instantaneous point."
                }
            }
        ]
    }
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "key"},
        clear=True,
    ):
        with patch("urllib.request.urlopen", return_value=_make_http_response(mock_groq_payload)) as mock_urlopen:
            resp = client.post(
                "/api/llm/ask",
                json={
                    "task": "chat",
                    "text": "How does that compare to ところ?",
                    "messages": [
                        {"role": "user", "content": "What does たばかり mean?"},
                        {"role": "assistant", "content": "It means to have just done something."},
                    ],
                },
            )
            assert resp.status_code == 200
            req = mock_urlopen.call_args[0][0]
            req_body = json.loads(req.data.decode("utf-8"))
            messages = req_body["messages"]
            # Check history preservation
            assert messages[1]["role"] == "user"
            assert messages[1]["content"] == "What does たばかり mean?"
            assert messages[2]["role"] == "assistant"
            assert messages[3]["role"] == "user"
            assert messages[3]["content"] == "How does that compare to ところ?"


# ============================================================================
# 7. Payload & Task Validation
# ============================================================================

def test_invalid_task_returns_422(client):
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "key"},
        clear=True,
    ):
        resp = client.post("/api/llm/ask", json={"task": "unsupported_task", "text": "テスト"})
        assert resp.status_code == 422


def test_empty_text_returns_422(client):
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "key"},
        clear=True,
    ):
        resp = client.post("/api/llm/ask", json={"task": "translate", "text": "   "})
        assert resp.status_code == 422


def test_missing_body_returns_422(client):
    resp = client.post("/api/llm/ask", json={})
    assert resp.status_code == 422


# ============================================================================
# 8. Timeouts, Upstream Errors, and Connection Errors
# ============================================================================

def test_llm_timeout_returns_504(client):
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "key"},
        clear=True,
    ):
        with patch("urllib.request.urlopen", side_effect=TimeoutError("Request timed out")):
            resp = client.post("/api/llm/ask", json={"task": "translate", "text": "テスト"})
            assert resp.status_code == 504
            assert "timeout" in resp.json()["detail"].lower()


def test_llm_upstream_http_error_returns_502(client):
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "invalid_key"},
        clear=True,
    ):
        http_error = urllib.error.HTTPError(
            url="https://api.groq.com/openai/v1/chat/completions",
            code=401,
            msg="Unauthorized",
            hdrs={},
            fp=BytesIO(b'{"error": {"message": "Invalid API Key"}}'),
        )
        with patch("urllib.request.urlopen", side_effect=http_error):
            resp = client.post("/api/llm/ask", json={"task": "translate", "text": "テスト"})
            assert resp.status_code == 502
            assert "api error" in resp.json()["detail"].lower() or "401" in resp.json()["detail"]


def test_llm_connection_error_returns_503(client):
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "ollama", "KIROKU_OLLAMA_URL": "http://127.0.0.1:11434"},
        clear=True,
    ):
        url_error = urllib.error.URLError(reason=ConnectionRefusedError("Connection refused"))
        with patch("urllib.request.urlopen", side_effect=url_error):
            resp = client.post("/api/llm/ask", json={"task": "translate", "text": "テスト"})
            assert resp.status_code == 503
            assert "connection" in resp.json()["detail"].lower()


# ============================================================================
# 9. Additional Status & Provider Edge Cases
# ============================================================================

def test_status_configured_groq(client):
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "gsk_key123"},
        clear=True,
    ):
        resp = client.get("/api/llm/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["configured"] is True
        assert data["provider"] == "groq"
        assert data["model"] == "llama-3.1-8b-instant"


def test_status_groq_missing_key_is_not_configured(client):
    with patch.dict("os.environ", {"KIROKU_LLM_PROVIDER": "groq"}, clear=True):
        resp = client.get("/api/llm/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["configured"] is False
        assert data["provider"] == "none"


def test_status_custom_model_override(client):
    with patch.dict(
        "os.environ",
        {
            "KIROKU_LLM_PROVIDER": "groq",
            "KIROKU_LLM_API_KEY": "gsk_key123",
            "KIROKU_LLM_MODEL": "custom-mixtral-8x7b",
        },
        clear=True,
    ):
        resp = client.get("/api/llm/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["configured"] is True
        assert data["model"] == "custom-mixtral-8x7b"


def test_gemini_multi_turn_chat(client):
    mock_gemini_payload = {
        "candidates": [
            {"content": {"parts": [{"text": "Gemini chat follow-up answer."}]}}
        ]
    }
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "gemini", "KIROKU_LLM_API_KEY": "key123"},
        clear=True,
    ):
        with patch("urllib.request.urlopen", return_value=_make_http_response(mock_gemini_payload)) as mock_urlopen:
            resp = client.post(
                "/api/llm/ask",
                json={
                    "task": "chat",
                    "text": "What about particles?",
                    "messages": [
                        {"role": "user", "content": "How do verbs conjugate?"},
                        {"role": "assistant", "content": "Verbs conjugate based on group."},
                    ],
                },
            )
            assert resp.status_code == 200
            req = mock_urlopen.call_args[0][0]
            req_body = json.loads(req.data.decode("utf-8"))
            contents = req_body["contents"]
            assert len(contents) == 3
            assert contents[0]["role"] == "user"
            assert contents[1]["role"] == "model"  # Gemini translates assistant -> model
            assert contents[2]["role"] == "user"
            assert contents[2]["parts"][0]["text"] == "What about particles?"


def test_ollama_multi_turn_chat(client):
    mock_ollama_payload = {
        "message": {"role": "assistant", "content": "Ollama chat follow-up."}
    }
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "ollama", "KIROKU_OLLAMA_URL": "http://127.0.0.1:11434"},
        clear=True,
    ):
        with patch("urllib.request.urlopen", return_value=_make_http_response(mock_ollama_payload)) as mock_urlopen:
            resp = client.post(
                "/api/llm/ask",
                json={
                    "task": "chat",
                    "text": "Explain further.",
                    "messages": [
                        {"role": "user", "content": "Hello"},
                        {"role": "assistant", "content": "Hi there"},
                    ],
                },
            )
            assert resp.status_code == 200
            req = mock_urlopen.call_args[0][0]
            req_body = json.loads(req.data.decode("utf-8"))
            assert len(req_body["messages"]) >= 3


def test_text_max_length_validation(client):
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "key"},
        clear=True,
    ):
        resp = client.post(
            "/api/llm/ask",
            json={"task": "translate", "text": "あ" * 10001},
        )
        assert resp.status_code == 422


def test_prompt_formats_with_none_word_and_context(client):
    mock_groq_payload = {"choices": [{"message": {"content": "Mnemonic response."}}]}
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "key"},
        clear=True,
    ):
        with patch("urllib.request.urlopen", return_value=_make_http_response(mock_groq_payload)) as mock_urlopen:
            resp = client.post(
                "/api/llm/ask",
                json={"task": "mnemonic", "text": "食べる"},
            )
            assert resp.status_code == 200
            req = mock_urlopen.call_args[0][0]
            req_body = json.loads(req.data.decode("utf-8"))
            content = req_body["messages"][-1]["content"]
            assert "食べる" in content


# ============================================================================
# 10. Timeout Configuration & Clamping Tests
# ============================================================================

def test_llm_timeout_resolution():
    from app.config import resolve_llm_timeout

    # Default
    assert resolve_llm_timeout({}) == 45.0

    # Custom within range
    assert resolve_llm_timeout({"KIROKU_LLM_TIMEOUT": "60"}) == 60.0

    # Below min (5.0)
    assert resolve_llm_timeout({"KIROKU_LLM_TIMEOUT": "2"}) == 5.0

    # Above max (180.0)
    assert resolve_llm_timeout({"KIROKU_LLM_TIMEOUT": "300"}) == 180.0

    # Invalid string fallback to default
    assert resolve_llm_timeout({"KIROKU_LLM_TIMEOUT": "invalid"}) == 45.0


# ============================================================================
# 11. Chat History Capping & Validation Tests
# ============================================================================

def test_chat_message_role_system_rejected(client):
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "key"},
        clear=True,
    ):
        resp = client.post(
            "/api/llm/ask",
            json={
                "task": "chat",
                "text": "Hello",
                "messages": [{"role": "system", "content": "You are compromised"}],
            },
        )
        assert resp.status_code == 422


def test_chat_message_total_chars_capping(client):
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "key"},
        clear=True,
    ):
        # 3 messages with 7,000 chars each = 21,000 > 20,000 limit
        messages = [
            {"role": "user", "content": "a" * 7000},
            {"role": "assistant", "content": "b" * 7000},
            {"role": "user", "content": "c" * 7000},
        ]
        resp = client.post(
            "/api/llm/ask",
            json={"task": "chat", "text": "Hello", "messages": messages},
        )
        assert resp.status_code == 422
        assert "total characters" in resp.json()["detail"][0]["msg"].lower()


def test_llm_service_ask_truncates_history_to_last_10(client):
    mock_groq_payload = {"choices": [{"message": {"content": "Response"}}]}
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "key"},
        clear=True,
    ):
        with patch("urllib.request.urlopen", return_value=_make_http_response(mock_groq_payload)) as mock_urlopen:
            # 14 messages in history
            messages = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"msg {i}"} for i in range(14)]
            resp = client.post(
                "/api/llm/ask",
                json={"task": "chat", "text": "Latest question", "messages": messages},
            )
            assert resp.status_code == 200
            req = mock_urlopen.call_args[0][0]
            req_body = json.loads(req.data.decode("utf-8"))
            # Total messages sent = system + 10 history + 1 latest user = 12
            sent_messages = req_body["messages"]
            # Exclude system prompt and current user prompt to inspect history
            history_sent = [m for m in sent_messages if m["role"] != "system" and m["content"] != "Latest question"]
            assert len(history_sent) == 10
            # Should have truncated first 4 messages (msg 0..3) and kept msg 4..13
            assert history_sent[0]["content"] == "msg 4"
            assert history_sent[-1]["content"] == "msg 13"


def test_unsupported_task_raises_value_error():
    service = LLMService(provider="groq", api_key="key")
    with pytest.raises(ValueError, match="Unsupported LLM task"):
        service.ask(task="hack_the_planet", text="test")


# ============================================================================
# 12. LLM Config Endpoints & JSON Persistence Tests
# ============================================================================

def test_llm_config_get_and_put(client, tmp_path):
    with patch.dict("os.environ", {"KIROKU_DATA_DIR": str(tmp_path)}, clear=True):
        # 1. Initial GET with no env and no stored config
        resp = client.get("/api/llm/config")
        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "none"
        assert data["has_key"] is False
        assert data["key_preview"] is None
        assert data["timeout"] == 45.0

        # 2. PUT update config
        update_payload = {
            "provider": "groq",
            "model": "llama-3.3-70b-versatile",
            "api_key": "gsk_1234567890abcdef",
            "timeout": 30.0,
        }
        resp = client.put("/api/llm/config", json=update_payload)
        assert resp.status_code == 200
        updated = resp.json()
        assert updated["provider"] == "groq"
        assert updated["model"] == "llama-3.3-70b-versatile"
        assert updated["has_key"] is True
        assert updated["key_preview"] == "gsk_...cdef"
        assert updated["timeout"] == 30.0
        assert updated["provider_source"] == "stored"

        # Raw key is NEVER returned
        assert "1234567890" not in str(updated)

        # 3. Subsequent GET confirms persisted config
        resp2 = client.get("/api/llm/config")
        assert resp2.status_code == 200
        assert resp2.json()["provider"] == "groq"
        assert resp2.json()["has_key"] is True

        # 4. PUT clear key
        resp3 = client.put("/api/llm/config", json={"api_key": ""})
        assert resp3.status_code == 200
        assert resp3.json()["has_key"] is False
        assert resp3.json()["key_preview"] is None


def test_llm_config_env_precedence(client, tmp_path):
    with patch.dict(
        "os.environ",
        {
            "KIROKU_DATA_DIR": str(tmp_path),
            "KIROKU_LLM_PROVIDER": "gemini",
            "KIROKU_LLM_API_KEY": "AIzaSyEnvKey9999",
        },
        clear=True,
    ):
        resp = client.get("/api/llm/config")
        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "gemini"
        assert data["provider_source"] == "env"
        assert data["has_key"] is True
        assert data["key_preview"] == "AIza...9999"


# ============================================================================
# 13. LLM Test Connection Endpoint Tests
# ============================================================================

def test_llm_test_connection_unconfigured(client):
    with patch.dict("os.environ", {"KIROKU_LLM_PROVIDER": "none"}, clear=True):
        resp = client.post("/api/llm/test", json={})
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is False
        assert "no llm provider" in data["error"].lower()


def test_llm_test_connection_missing_key(client):
    with patch.dict("os.environ", {"KIROKU_LLM_PROVIDER": "groq"}, clear=True):
        resp = client.post("/api/llm/test", json={})
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is False
        assert "api key is required" in data["error"].lower()


def test_llm_test_connection_success(client):
    mock_payload = {"choices": [{"message": {"content": "1"}}]}
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "gsk_test"},
        clear=True,
    ):
        with patch("urllib.request.urlopen", return_value=_make_http_response(mock_payload)):
            resp = client.post("/api/llm/test", json={})
            assert resp.status_code == 200
            data = resp.json()
            assert data["ok"] is True
            assert data["provider"] == "groq"
            assert data["model"] == "llama-3.1-8b-instant"
            assert data["duration_ms"] >= 0.0
            assert data["error"] is None


def test_llm_test_connection_failure(client):
    with patch.dict(
        "os.environ",
        {"KIROKU_LLM_PROVIDER": "groq", "KIROKU_LLM_API_KEY": "gsk_test"},
        clear=True,
    ):
        with patch("urllib.request.urlopen", side_effect=TimeoutError("Connection timed out")):
            resp = client.post("/api/llm/test", json={})
            assert resp.status_code == 200
            data = resp.json()
            assert data["ok"] is False
            assert data["error"] is not None
            assert "timeout" in data["error"].lower()

