from voice_agent.actions.schema import AgentActionEnvelope


def test_action_envelope_schema() -> None:
    message = AgentActionEnvelope(
        action={
            "name": "navigate",
            "params": {"screen": "Notes", "prefill": "Follow up tomorrow"},
            "policy": {"requiresConfirmation": False},
        }
    )

    dumped = message.model_dump()
    assert dumped["type"] == "action"
    assert dumped["version"] == "1.0"
    assert dumped["action"]["name"] == "navigate"
