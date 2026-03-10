from voice_agent.entrypoint import (
    _deep_find_answer,
    _extract_execution_id,
    _extract_n8n_answer,
)


def test_extract_n8n_answer_priority():
    assert _extract_n8n_answer({"replyText": "reply"}) == "reply"
    assert _extract_n8n_answer({"answer": "answer"}) == "answer"
    assert _extract_n8n_answer({"data": {"text": "nested"}}) == "nested"


def test_deep_find_answer():
    payload = {
        "execution": {
            "resultData": {
                "runData": {
                    "Node": [{"data": {"main": [[{"json": {"output": "from-run-data"}}]]}}]
                }
            }
        }
    }
    assert _deep_find_answer(payload) == "from-run-data"


def test_extract_execution_id():
    assert _extract_execution_id({"id": "123"}) == "123"
    assert _extract_execution_id({"data": {"executionId": "abc"}}) == "abc"

