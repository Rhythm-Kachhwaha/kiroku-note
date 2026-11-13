from test_study_http_api import study_test_env


def test_incorrect_history_supports_level_and_format_filters(study_test_env):
    client = study_test_env["client"]

    response = client.get(
        "/api/study/v1/history/incorrect",
        params={"level": "N5", "format_code": "kanji_reading", "limit": 10},
    )

    assert response.status_code == 200
    assert response.json()["items"] == []

    # Verify empty string filter does not trigger 422 Unprocessable Entity
    resp_empty = client.get(
        "/api/study/v1/history/incorrect",
        params={"level": "", "format_code": "", "limit": 10},
    )
    assert resp_empty.status_code == 200
