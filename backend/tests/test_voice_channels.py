"""BDD-driven tests for multi-room voice channels — powered by pytest-bdd.

Scenarios are defined in features/voice-channels.feature.
Step definitions are co-located here for pytest-bdd discovery.

All step functions are SYNCHRONOUS and delegate async work to the
managed ``async_loop`` fixture. This avoids the pytest-bdd /
pytest-asyncio compatibility issue where generated test functions
are sync and cannot await coroutines.
"""

import uuid

import pytest
from pytest_bdd import given, when, then, parsers, scenarios
from unittest.mock import patch

from conftest import (
    OWNER_ID, MEMBER_ID,
    OWNER_NAME, MEMBER_NAME,
)

from database.models import VoiceChannel
from services.voice_room import VoiceRoomManager

# Load all scenarios from the feature file
scenarios("features/voice-channels.feature")


# ── Shared scenario context fixture ─────────────────────────────

@pytest.fixture
def scenario(test_repo, fake_ws, async_loop):
    """Mutable context dict shared across steps within a scenario."""
    mgr = VoiceRoomManager()
    return {
        "repo": test_repo,
        "ws": fake_ws,
        "loop": async_loop,
        "manager": mgr,
        "responses": [],
        "channel_map": {},  # name -> id mapping
    }


# ── Helpers ──────────────────────────────────────────────────────

def _user_name_to_id(name: str) -> str:
    mapping = {
        OWNER_NAME: OWNER_ID,
        MEMBER_NAME: MEMBER_ID,
    }
    return mapping.get(name, name)


def _run(loop, coro):
    """Run a coroutine on the managed event loop synchronously."""
    return loop.run_until_complete(coro)


def _make_jwt(user_id: str, is_admin: bool = False, is_owner: bool = False) -> dict:
    """Create a fake JWT payload for request context patching."""
    return {
        "id": user_id,
        "is_admin": is_admin,
        "is_owner": is_owner,
    }


OWNER_JWT = _make_jwt(OWNER_ID, is_admin=True, is_owner=True)
MEMBER_JWT = _make_jwt(MEMBER_ID, is_admin=False, is_owner=False)


def _patch_voice_channels_api(scenario):
    """Return a context manager that patches the voice_channels API module."""
    from api import voice_channels as vc_mod
    return patch.object(vc_mod, "repo", scenario["repo"]), \
           patch.object(vc_mod, "ws_manager", scenario["ws"]), \
           patch.object(vc_mod, "voice_room_manager", scenario["manager"])


def _patch_voice_api(scenario, jwt):
    """Return context managers that patch the voice API module."""
    from api import voice as voice_mod
    return patch.object(voice_mod, "repo", scenario["repo"]), \
           patch.object(voice_mod, "ws_manager", scenario["ws"]), \
           patch.object(voice_mod, "voice_room_manager", scenario["manager"]), \
           patch.object(voice_mod, "current_user", return_value=jwt)


def _ensure_ws_connection(ws, user_id):
    """Register a fake WS connection for the user (needed for connection_id validation)."""
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(ws.connect(user_id))
    finally:
        loop.close()


import asyncio


# ══════════════════════════════════════════════════════════════════
# GIVEN steps
# ══════════════════════════════════════════════════════════════════

@given('the database has owner "owner_user" and member "member_alice"')
def given_db_with_users(scenario):
    """Seeded DB already has these users via test_repo fixture."""
    pass


@given('a default voice channel "General" exists')
def given_default_voice_channel(scenario):
    loop = scenario["loop"]
    repo = scenario["repo"]
    vc = _run(loop, repo.create_voice_channel("General", OWNER_ID))
    assert vc is not None, "Failed to create default voice channel"
    scenario["channel_map"]["General"] = vc.id


@given(parsers.parse('"{username}" is in voice channel "{channel_name}"'))
def given_user_in_voice_channel(scenario, username, channel_name):
    """Put user directly into the VoiceRoomManager (bypassing API validation)."""
    user_id = _user_name_to_id(username)
    channel_id = scenario["channel_map"].get(channel_name)
    assert channel_id is not None, f"Voice channel '{channel_name}' not found in channel_map"
    mgr = scenario["manager"]
    mgr.join_channel(channel_id, user_id, f"conn-{user_id[:8]}")


@given(parsers.parse('"{username}" creates a voice channel named "{channel_name}"'))
def given_create_voice_channel(scenario, username, channel_name):
    """Create a voice channel via the API (used as Given step)."""
    _execute_create_voice_channel(scenario, username, channel_name)


@given(parsers.parse('"{username}" joins voice channel "{channel_name}" with connection "{conn_id}"'))
def given_join_voice_channel(scenario, username, channel_name, conn_id):
    """Join a voice channel via the API (used as Given step)."""
    _execute_join_voice_channel(scenario, username, channel_name, conn_id)


@given('a fresh database with no voice channels')
def given_fresh_db_no_voice_channels(scenario):
    """Nothing extra to do — test_repo starts without voice_channels table seeded."""
    pass


@given('the database has 19 voice channels')
def given_19_voice_channels(scenario):
    loop = scenario["loop"]
    repo = scenario["repo"]
    # Channel "General" already exists (from background), create 18 more
    for i in range(2, 20):
        cname = f"Channel-{i:02d}"
        vc = _run(loop, repo.create_voice_channel(cname, OWNER_ID))
        assert vc is not None, f"Failed to create {cname}"
        scenario["channel_map"][cname] = vc.id


# ══════════════════════════════════════════════════════════════════
# WHEN steps
# ══════════════════════════════════════════════════════════════════

@when(parsers.parse('"{username}" creates a voice channel named "{channel_name}"'))
def when_create_voice_channel(scenario, username, channel_name):
    _execute_create_voice_channel(scenario, username, channel_name)


@when('"owner_user" creates a voice channel with an empty name')
def when_create_empty_name(scenario):
    _execute_create_voice_channel(scenario, "owner_user", "")


@when('"owner_user" creates a voice channel with a name exceeding 24 characters')
def when_create_long_name(scenario):
    _execute_create_voice_channel(scenario, "owner_user", "ThisNameIsWayTooLongForTheLimit")


@when('an unauthenticated user creates a voice channel named "Music"')
def when_unauthenticated_creates_voice_channel(scenario):
    from api import voice_channels as vc_mod
    loop = scenario["loop"]

    with patch.object(vc_mod, "repo", scenario["repo"]), \
         patch.object(vc_mod, "ws_manager", scenario["ws"]), \
         patch.object(vc_mod, "current_user", return_value=None), \
         patch.object(vc_mod, "current_user_is_admin", return_value=False), \
         patch.object(vc_mod, "current_user_is_owner", return_value=False):
        response = _run(loop, vc_mod.create_voice_channel({"name": "Music"}))

    scenario["responses"].append(response)


@when('the system lists all voice channels')
def when_list_voice_channels(scenario):
    from api import voice_channels as vc_mod
    loop = scenario["loop"]

    with patch.object(vc_mod, "repo", scenario["repo"]), \
         patch.object(vc_mod, "voice_room_manager", scenario["manager"]):
        result = _run(loop, vc_mod.list_voice_channels())

    scenario["responses"].append(result)


@when(parsers.parse('"{username}" deletes the voice channel "{channel_name}"'))
def when_delete_voice_channel(scenario, username, channel_name):
    from api import voice_channels as vc_mod

    user_id = _user_name_to_id(username)
    jwt = _make_jwt(user_id, is_admin=(user_id == OWNER_ID), is_owner=(user_id == OWNER_ID))
    channel_id = scenario["channel_map"].get(channel_name)
    loop = scenario["loop"]

    with patch.object(vc_mod, "repo", scenario["repo"]), \
         patch.object(vc_mod, "ws_manager", scenario["ws"]), \
         patch.object(vc_mod, "voice_room_manager", scenario["manager"]), \
         patch.object(vc_mod, "current_user", return_value=jwt), \
         patch.object(vc_mod, "current_user_is_admin", return_value=jwt["is_admin"]), \
         patch.object(vc_mod, "current_user_is_owner", return_value=jwt["is_owner"]):
        response = _run(loop, vc_mod.delete_voice_channel(channel_id))

    scenario["responses"].append(response)


@when('"owner_user" deletes a nonexistent voice channel')
def when_delete_nonexistent_voice_channel(scenario):
    from api import voice_channels as vc_mod
    loop = scenario["loop"]
    fake_id = str(uuid.uuid4())

    with patch.object(vc_mod, "repo", scenario["repo"]), \
         patch.object(vc_mod, "ws_manager", scenario["ws"]), \
         patch.object(vc_mod, "voice_room_manager", scenario["manager"]), \
         patch.object(vc_mod, "current_user", return_value=OWNER_JWT), \
         patch.object(vc_mod, "current_user_is_admin", return_value=True), \
         patch.object(vc_mod, "current_user_is_owner", return_value=True):
        response = _run(loop, vc_mod.delete_voice_channel(fake_id))

    scenario["responses"].append(response)


@when(parsers.parse('"{username}" switches to voice channel "{channel_name}"'))
def when_switch_voice_channel(scenario, username, channel_name):
    """Switch user to a different voice channel via VoiceRoomManager directly."""
    user_id = _user_name_to_id(username)
    channel_id = scenario["channel_map"].get(channel_name)
    assert channel_id is not None, f"Channel '{channel_name}' not found in channel_map"
    mgr = scenario["manager"]
    mgr.join_channel(channel_id, user_id, f"conn-{user_id[:8]}")


@when(parsers.parse('"{username}" joins voice channel "{channel_name}" with connection "{conn_id}"'))
def when_join_voice_channel(scenario, username, channel_name, conn_id):
    _execute_join_voice_channel(scenario, username, channel_name, conn_id)


@when(parsers.parse('"{username}" tries to join voice again on channel "{channel_name}"'))
def when_join_voice_duplicate(scenario, username, channel_name):
    """Attempt to join voice when already in voice (expects 409)."""
    from api import voice as voice_mod

    user_id = _user_name_to_id(username)
    jwt = _make_jwt(user_id, is_admin=(user_id == OWNER_ID), is_owner=(user_id == OWNER_ID))
    channel_id = scenario["channel_map"].get(channel_name)
    loop = scenario["loop"]

    # Register a WS connection with the conn_id we'll use
    ws = scenario["ws"]
    conn_id = f"conn-{user_id[:8]}-dup"
    if user_id not in ws.connections:
        ws.connections[user_id] = {}
    ws.connections[user_id][conn_id] = True

    with patch.object(voice_mod, "repo", scenario["repo"]), \
         patch.object(voice_mod, "ws_manager", scenario["ws"]), \
         patch.object(voice_mod, "voice_room_manager", scenario["manager"]), \
         patch.object(voice_mod, "current_user", return_value=jwt):
        response = _run(loop, voice_mod.join_voice({
            "connection_id": conn_id,
            "channel_id": channel_id,
        }))

    scenario["responses"].append(response)


@when(parsers.parse('"{username}" leaves voice'))
def when_leave_voice(scenario, username):
    from api import voice as voice_mod

    user_id = _user_name_to_id(username)
    jwt = _make_jwt(user_id, is_admin=(user_id == OWNER_ID), is_owner=(user_id == OWNER_ID))
    loop = scenario["loop"]

    with patch.object(voice_mod, "repo", scenario["repo"]), \
         patch.object(voice_mod, "ws_manager", scenario["ws"]), \
         patch.object(voice_mod, "voice_room_manager", scenario["manager"]), \
         patch.object(voice_mod, "current_user", return_value=jwt):
        response = _run(loop, voice_mod.leave_voice({}))

    scenario["responses"].append(response)


@when('the voice room manager removes room "General"')
def when_manager_removes_room(scenario):
    channel_id = scenario["channel_map"].get("General")
    scenario["manager"].remove_room(channel_id)


@when('the system migrates the default voice channel')
def when_migrate_default(scenario):
    loop = scenario["loop"]
    repo = scenario["repo"]
    from constants import DEFAULT_VOICE_CHANNEL_NAME
    _run(loop, repo.migrate_default_voice_channel(DEFAULT_VOICE_CHANNEL_NAME))


# ══════════════════════════════════════════════════════════════════
# THEN steps
# ══════════════════════════════════════════════════════════════════

@then(parsers.parse('the system returns status {status:d}'))
def then_returns_status(scenario, status):
    response = scenario["responses"][-1]
    assert response.status_code == status, \
        f"Expected status {status}, got {response.status_code}: {getattr(response, 'body', None)}"


@then(parsers.parse('the system returns status {status:d} with error "{error_msg}"'))
def then_returns_status_with_error(scenario, status, error_msg):
    response = scenario["responses"][-1]
    assert response.status_code == status, \
        f"Expected status {status}, got {response.status_code}: {getattr(response, 'body', None)}"
    assert error_msg in response.body.get("error", ""), \
        f"Expected error containing '{error_msg}', got '{response.body.get('error', '')}'"


@then(parsers.parse('the response contains a voice channel named "{channel_name}"'))
def then_response_contains_channel(scenario, channel_name):
    response = scenario["responses"][-1]
    assert response.body.get("name") == channel_name, \
        f"Expected voice channel name '{channel_name}', got '{response.body.get('name')}'"


@then('a "voice_channel_created" WebSocket event is broadcast')
def then_ws_voice_channel_created(scenario):
    assert scenario["ws"].broadcasts, "No broadcasts recorded"
    last = scenario["ws"].last_broadcast
    assert last["message"]["type"] == "voice_channel_created", \
        f"Expected 'voice_channel_created', got '{last['message']['type']}'"


@then('the response contains at least 2 voice channels')
def then_response_at_least_2(scenario):
    result = scenario["responses"][-1]
    assert isinstance(result, list), f"Expected list, got {type(result)}"
    assert len(result) >= 2, f"Expected at least 2 voice channels, got {len(result)}"


@then('each voice channel has an id field')
def then_each_has_id_field(scenario):
    result = scenario["responses"][-1]
    for vc in result:
        assert "id" in vc, f"Voice channel missing 'id': {vc}"


@then('each channel listing includes participant count')
def then_each_has_participant_count(scenario):
    result = scenario["responses"][-1]
    for vc in result:
        assert "participant_count" in vc, f"Voice channel missing 'participant_count': {vc}"


@then('a "voice_channel_deleted" WebSocket event is broadcast')
def then_ws_voice_channel_deleted(scenario):
    assert scenario["ws"].broadcasts, "No broadcasts recorded"
    # Search all broadcasts for the event (may not be the last one)
    found = False
    for b in scenario["ws"].broadcasts:
        if b["message"]["type"] == "voice_channel_deleted":
            found = True
            break
    assert found, f"No 'voice_channel_deleted' broadcast found. Types: {[b['message']['type'] for b in scenario['ws'].broadcasts]}"


@then(parsers.parse('"{username}" is in voice channel "{channel_name}"'))
def then_user_in_channel(scenario, username, channel_name):
    user_id = _user_name_to_id(username)
    mgr = scenario["manager"]
    expected_id = scenario["channel_map"].get(channel_name)
    actual_id = mgr.user_channel(user_id)
    assert actual_id == expected_id, \
        f"Expected {username} in channel '{channel_name}' ({expected_id}), got {actual_id}"


@then(parsers.parse('"{username}" is not in any voice channel'))
def then_user_not_in_voice(scenario, username):
    user_id = _user_name_to_id(username)
    mgr = scenario["manager"]
    assert not mgr.is_in_voice(user_id), \
        f"{username} should not be in any voice channel but is in {mgr.user_channel(user_id)}"


@then(parsers.parse('the voice room for "{channel_name}" has {count:d} participant'))
def then_room_participant_count(scenario, channel_name, count):
    channel_id = scenario["channel_map"].get(channel_name)
    mgr = scenario["manager"]
    actual = mgr.room_participant_count(channel_id)
    assert actual == count, \
        f"Expected {count} participants in '{channel_name}', got {actual}"


@then('a "voice_participant_joined" WebSocket event is broadcast with channel_id "General"')
def then_ws_participant_joined(scenario):
    assert scenario["ws"].broadcasts, "No broadcasts recorded"
    last = scenario["ws"].last_broadcast
    assert last["message"]["type"] == "voice_participant_joined", \
        f"Expected 'voice_participant_joined', got '{last['message']['type']}'"
    assert "channel_id" in last["message"]["data"], \
        "voice_participant_joined event missing channel_id"


@then('a "voice_participant_left" WebSocket event is broadcast')
def then_ws_participant_left(scenario):
    assert scenario["ws"].broadcasts, "No broadcasts recorded"
    found = False
    for b in scenario["ws"].broadcasts:
        if b["message"]["type"] == "voice_participant_left":
            found = True
            break
    assert found, "No 'voice_participant_left' broadcast found"


@then('the database has exactly 1 voice channel named "General"')
def then_db_has_one_general(scenario):
    loop = scenario["loop"]
    repo = scenario["repo"]
    channels = _run(loop, repo.list_voice_channels())
    assert len(channels) == 1, f"Expected 1 voice channel, got {len(channels)}"
    assert channels[0].name == "General", f"Expected 'General', got '{channels[0].name}'"
    scenario["channel_map"]["General"] = channels[0].id


# ══════════════════════════════════════════════════════════════════
# Shared execution helpers (used by both Given and When steps)
# ══════════════════════════════════════════════════════════════════

def _execute_create_voice_channel(scenario, username, channel_name):
    """Execute voice channel creation via the API with proper patching."""
    from api import voice_channels as vc_mod

    user_id = _user_name_to_id(username)
    jwt = _make_jwt(user_id, is_admin=(user_id == OWNER_ID), is_owner=(user_id == OWNER_ID))
    loop = scenario["loop"]

    with patch.object(vc_mod, "repo", scenario["repo"]), \
         patch.object(vc_mod, "ws_manager", scenario["ws"]), \
         patch.object(vc_mod, "current_user", return_value=jwt), \
         patch.object(vc_mod, "current_user_is_admin", return_value=jwt["is_admin"]), \
         patch.object(vc_mod, "current_user_is_owner", return_value=jwt["is_owner"]):
        response = _run(loop, vc_mod.create_voice_channel({"name": channel_name}))

    scenario["responses"].append(response)
    # Track the channel if created successfully
    if hasattr(response, 'status_code') and response.status_code == 201:
        scenario["channel_map"][channel_name] = response.body["id"]


def _execute_join_voice_channel(scenario, username, channel_name, conn_id):
    """Execute voice join via the API with proper patching."""
    from api import voice as voice_mod

    user_id = _user_name_to_id(username)
    jwt = _make_jwt(user_id, is_admin=(user_id == OWNER_ID), is_owner=(user_id == OWNER_ID))
    channel_id = scenario["channel_map"].get(channel_name)
    assert channel_id is not None, f"Channel '{channel_name}' not found in channel_map"
    loop = scenario["loop"]

    # Register a WS connection so the connection_id validation passes.
    # FakeConnectionManager.connect() generates a random conn_id, but the API
    # validates the *provided* conn_id against active connections. So we must
    # manually register the provided conn_id in the fake's connections dict.
    ws = scenario["ws"]
    if user_id not in ws.connections:
        ws.connections[user_id] = {}
    ws.connections[user_id][conn_id] = True

    with patch.object(voice_mod, "repo", scenario["repo"]), \
         patch.object(voice_mod, "ws_manager", scenario["ws"]), \
         patch.object(voice_mod, "voice_room_manager", scenario["manager"]), \
         patch.object(voice_mod, "current_user", return_value=jwt):
        response = _run(loop, voice_mod.join_voice({
            "connection_id": conn_id,
            "channel_id": channel_id,
        }))

    scenario["responses"].append(response)
