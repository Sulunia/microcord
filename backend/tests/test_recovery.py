"""BDD-driven tests for account recovery — powered by pytest-bdd.

Scenarios are defined in features/recovery.feature.
Step definitions are co-located in this file so pytest-bdd discovers
them automatically alongside scenarios().

All step functions are SYNCHRONOUS and delegate async work to the
managed ``async_loop`` fixture (which shares the same event loop as
the test database). This avoids the pytest-bdd / pytest-asyncio
compatibility issue where generated test functions are sync and
cannot await coroutines.
"""

import hashlib
from unittest.mock import patch, AsyncMock

import bcrypt
import pytest
from pytest_bdd import given, when, then, parsers, scenarios

from conftest import (
    OWNER_ID, MEMBER_ID, SECOND_MEMBER_ID,
    OWNER_NAME, MEMBER_NAME, SECOND_MEMBER_NAME,
    MEMBER_PASSWORD,
    VALID_RECOVERY_PASSPHRASE, VALID_RECOVERY_HASH,
    EXPIRED_RECOVERY_PASSPHRASE,
)

# Load all scenarios from the feature file
scenarios("features/recovery.feature")


# ── Shared context fixture ───────────────────────────────────────

@pytest.fixture
def ctx(test_repo, fake_ws, async_loop):
    """Mutable context dict shared across steps within a scenario."""
    return {
        "repo": test_repo,
        "ws": fake_ws,
        "loop": async_loop,
        "responses": [],
        "passphrases": [],
    }


# ── Helpers ──────────────────────────────────────────────────────

def _user_name_to_id(name: str) -> str:
    mapping = {
        OWNER_NAME: OWNER_ID,
        MEMBER_NAME: MEMBER_ID,
        SECOND_MEMBER_NAME: SECOND_MEMBER_ID,
    }
    return mapping.get(name, name)


def _run(loop, coro):
    """Run a coroutine on the managed event loop synchronously."""
    return loop.run_until_complete(coro)


# ══════════════════════════════════════════════════════════════════
# GIVEN steps
# ══════════════════════════════════════════════════════════════════

@given('the database has owner "owner_user" and member "member_alice"')
def given_db_with_owner_and_member(ctx):
    """Seeded DB already has these users via test_repo fixture."""
    pass


@given('the database has owner "owner_user"')
def given_db_with_owner(ctx):
    pass


@given(parsers.parse('"{username}" has a valid pending recovery'))
def given_pending_recovery(ctx, username, seeded_repo_with_pending_recovery):
    ctx["repo"] = seeded_repo_with_pending_recovery


@given(parsers.parse('"{username}" has an expired pending recovery'))
def given_expired_recovery(ctx, username, seeded_repo_with_expired_recovery):
    ctx["repo"] = seeded_repo_with_expired_recovery


# ══════════════════════════════════════════════════════════════════
# WHEN steps
# ══════════════════════════════════════════════════════════════════

@when(parsers.parse('"{caller}" initiates recovery for "{target}"'))
def when_initiate_recovery(ctx, caller, target):
    from api import users as users_mod
    from services import auth as auth_mod

    target_id = _user_name_to_id(target)
    caller_id = _user_name_to_id(caller)
    is_owner = (caller == OWNER_NAME)
    loop = ctx["loop"]

    with patch.object(users_mod, "repo", ctx["repo"]), \
         patch.object(users_mod, "ws_manager", ctx["ws"]), \
         patch.object(users_mod, "current_user_is_owner", return_value=is_owner), \
         patch.object(users_mod, "current_user_id", return_value=caller_id), \
         patch.object(auth_mod, "repo", ctx["repo"]), \
         patch.object(users_mod, "revoke_all_refresh_tokens", new_callable=AsyncMock) as mock_revoke, \
         patch.object(users_mod, "guard") as mock_guard:

        response = _run(loop, users_mod.recover_account(target_id))
        ctx["_mock_revoke"] = mock_revoke
        ctx["_mock_guard"] = mock_guard

    ctx["responses"].append(response)


@when(parsers.parse('"{caller}" initiates recovery for own account'))
def when_initiate_self_recovery(ctx, caller):
    from api import users as users_mod
    from services import auth as auth_mod

    caller_id = _user_name_to_id(caller)
    loop = ctx["loop"]

    with patch.object(users_mod, "repo", ctx["repo"]), \
         patch.object(users_mod, "ws_manager", ctx["ws"]), \
         patch.object(users_mod, "current_user_is_owner", return_value=True), \
         patch.object(users_mod, "current_user_id", return_value=caller_id), \
         patch.object(auth_mod, "repo", ctx["repo"]), \
         patch.object(users_mod, "revoke_all_refresh_tokens", new_callable=AsyncMock) as mock_revoke, \
         patch.object(users_mod, "guard") as mock_guard:

        response = _run(loop, users_mod.recover_account(caller_id))
        ctx["_mock_revoke"] = mock_revoke
        ctx["_mock_guard"] = mock_guard

    ctx["responses"].append(response)


@when(parsers.parse('"{caller}" attempts to initiate recovery for "{target}"'))
def when_non_owner_tries_recovery(ctx, caller, target):
    from api import users as users_mod

    target_id = _user_name_to_id(target)
    caller_id = _user_name_to_id(caller)
    loop = ctx["loop"]

    with patch.object(users_mod, "repo", ctx["repo"]), \
         patch.object(users_mod, "current_user_is_owner", return_value=False), \
         patch.object(users_mod, "current_user_id", return_value=caller_id):

        response = _run(loop, users_mod.recover_account(target_id))

    ctx["responses"].append(response)


@when(parsers.parse('"{caller}" attempts to recover a nonexistent account'))
def when_recover_nonexistent(ctx, caller):
    from api import users as users_mod

    caller_id = _user_name_to_id(caller)
    fake_id = "00000000-0000-0000-0000-000000000999"
    loop = ctx["loop"]

    with patch.object(users_mod, "repo", ctx["repo"]), \
         patch.object(users_mod, "current_user_is_owner", return_value=True), \
         patch.object(users_mod, "current_user_id", return_value=caller_id):

        response = _run(loop, users_mod.recover_account(fake_id))

    ctx["responses"].append(response)


@when(parsers.parse('"{caller}" initiates recovery for "{target}" twice'))
def when_initiate_recovery_twice(ctx, caller, target):
    from api import users as users_mod
    from services import auth as auth_mod

    target_id = _user_name_to_id(target)
    caller_id = _user_name_to_id(caller)
    loop = ctx["loop"]

    for _ in range(2):
        with patch.object(users_mod, "repo", ctx["repo"]), \
             patch.object(users_mod, "ws_manager", ctx["ws"]), \
             patch.object(users_mod, "current_user_is_owner", return_value=True), \
             patch.object(users_mod, "current_user_id", return_value=caller_id), \
             patch.object(auth_mod, "repo", ctx["repo"]), \
             patch.object(users_mod, "revoke_all_refresh_tokens", new_callable=AsyncMock):

            response = _run(loop, users_mod.recover_account(target_id))

        ctx["responses"].append(response)
        ctx["passphrases"].append(response.body.get("recovery_passphrase", ""))


@when(parsers.parse(
    '"{username}" recovers with the correct passphrase and new password "{new_password}"'
))
def when_recover_with_correct_passphrase(ctx, username, new_password):
    from api import auth as auth_mod
    from services import auth as auth_svc

    passphrase = ctx.get("_generated_passphrase", VALID_RECOVERY_PASSPHRASE)
    loop = ctx["loop"]

    with patch.object(auth_mod, "repo", ctx["repo"]), \
         patch.object(auth_svc, "repo", ctx["repo"]):

        response = _run(loop, auth_mod._try_account_recovery(
            username, new_password, passphrase
        ))

    ctx["responses"].append(response)


@when(parsers.parse(
    '"{username}" recovers with the received passphrase and new password "{new_password}"'
))
def when_recover_with_received_passphrase(ctx, username, new_password):
    from api import auth as auth_mod
    from services import auth as auth_svc

    passphrase = ctx["responses"][-1].body["recovery_passphrase"]
    ctx["_generated_passphrase"] = passphrase
    loop = ctx["loop"]

    with patch.object(auth_mod, "repo", ctx["repo"]), \
         patch.object(auth_svc, "repo", ctx["repo"]):

        response = _run(loop, auth_mod._try_account_recovery(
            username, new_password, passphrase
        ))

    ctx["responses"].append(response)


@when(parsers.parse('the system attempts to recover "{username}" with an arbitrary passphrase'))
def when_try_recovery_arbitrary(ctx, username):
    from api import auth as auth_mod

    loop = ctx["loop"]

    with patch.object(auth_mod, "repo", ctx["repo"]):
        result = _run(loop, auth_mod._try_account_recovery(
            username, "any_password", "any_passphrase"
        ))

    ctx["responses"].append(result)


@when(parsers.parse('"{username}" attempts to recover with the expired passphrase'))
def when_recover_with_expired(ctx, username):
    from api import auth as auth_mod

    loop = ctx["loop"]

    with patch.object(auth_mod, "repo", ctx["repo"]):
        response = _run(loop, auth_mod._try_account_recovery(
            username, "new_password", EXPIRED_RECOVERY_PASSPHRASE
        ))

    ctx["responses"].append(response)


@when(parsers.parse('"{username}" attempts to recover with passphrase "{passphrase}"'))
def when_recover_with_wrong_passphrase(ctx, username, passphrase):
    from api import auth as auth_mod

    loop = ctx["loop"]

    with patch.object(auth_mod, "repo", ctx["repo"]):
        response = _run(loop, auth_mod._try_account_recovery(
            username, "new_password", passphrase
        ))

    ctx["responses"].append(response)


@when(parsers.parse('"{username}" attempts to recover with wrong passphrase'))
def when_recover_wrong_passphrase_generic(ctx, username):
    from api import auth as auth_mod

    loop = ctx["loop"]

    with patch.object(auth_mod, "repo", ctx["repo"]):
        response = _run(loop, auth_mod._try_account_recovery(
            username, "new_pass", "WRONG"
        ))

    ctx["responses"].append(response)


@when(parsers.parse('"{username}" attempts to recover with wrong passphrase again'))
def when_recover_wrong_passphrase_again(ctx, username):
    from api import auth as auth_mod

    loop = ctx["loop"]

    with patch.object(auth_mod, "repo", ctx["repo"]):
        response = _run(loop, auth_mod._try_account_recovery(
            username, "new_pass", "ALSO_WRONG"
        ))

    ctx["responses"].append(response)


@when('the system tries to recover again with the same passphrase')
def when_retry_same_passphrase(ctx):
    from api import auth as auth_mod

    username = ctx["responses"][-1].body.get("user", {}).get("name", MEMBER_NAME)
    loop = ctx["loop"]

    with patch.object(auth_mod, "repo", ctx["repo"]):
        result = _run(loop, auth_mod._try_account_recovery(
            username, "another_password", VALID_RECOVERY_PASSPHRASE
        ))

    ctx["responses"].append(result)


# ══════════════════════════════════════════════════════════════════
# THEN steps
# ══════════════════════════════════════════════════════════════════

@then(parsers.parse('the system returns status {status:d} with a passphrase of {length:d} characters'))
def then_returns_passphrase(ctx, status, length):
    response = ctx["responses"][-1]
    assert response.status_code == status
    assert "recovery_passphrase" in response.body
    assert len(response.body["recovery_passphrase"]) == length


@then(parsers.parse('the system returns status {status:d}'))
def then_returns_status(ctx, status):
    response = ctx["responses"][-1]
    assert response.status_code == status


@then(parsers.parse('the system returns status {status:d} with error "{error_msg}"'))
def then_returns_status_with_error(ctx, status, error_msg):
    response = ctx["responses"][-1]
    assert response.status_code == status
    assert error_msg in response.body.get("error", "")


@then(parsers.parse('the system returns status {status:d} with error containing "{word}"'))
def then_returns_status_error_contains(ctx, status, word):
    response = ctx["responses"][-1]
    assert response.status_code == status
    assert word.lower() in response.body.get("error", "").lower()


@then(parsers.parse('the system returns status {status:d} with access_token and refresh_token'))
def then_returns_tokens(ctx, status):
    response = ctx["responses"][-1]
    assert response.status_code == status
    assert "access_token" in response.body
    assert "refresh_token" in response.body
    assert response.body["user"]["name"] == MEMBER_NAME


@then('the result is None')
def then_result_is_none(ctx):
    assert ctx["responses"][-1] is None


@then(parsers.parse('the password of "{username}" is removed from the database'))
def then_password_removed(ctx, username):
    user_id = _user_name_to_id(username)
    loop = ctx["loop"]
    user = _run(loop, ctx["repo"].get_user_by_id(user_id))
    assert user.password_hash is None


@then('the owner password is removed from the database')
def then_owner_password_removed(ctx):
    loop = ctx["loop"]
    user = _run(loop, ctx["repo"].get_user_by_id(OWNER_ID))
    assert user.password_hash is None


@then(parsers.parse('a recovery_hash is set for "{username}"'))
def then_recovery_hash_set(ctx, username):
    user_id = _user_name_to_id(username)
    loop = ctx["loop"]
    user = _run(loop, ctx["repo"].get_user_by_id(user_id))
    assert user.recovery_hash is not None


@then(parsers.parse('the recovery of "{username}" has an expiry date'))
def then_recovery_has_expiry(ctx, username):
    user_id = _user_name_to_id(username)
    loop = ctx["loop"]
    user = _run(loop, ctx["repo"].get_user_by_id(user_id))
    assert user.recovery_expires_at is not None


@then('the recovery has no expiry date')
def then_recovery_no_expiry(ctx):
    loop = ctx["loop"]
    user = _run(loop, ctx["repo"].get_user_by_id(OWNER_ID))
    assert user.recovery_expires_at is None


@then(parsers.parse('the database remains unchanged for "{username}"'))
def then_db_unchanged(ctx, username):
    user_id = _user_name_to_id(username)
    loop = ctx["loop"]
    user = _run(loop, ctx["repo"].get_user_by_id(user_id))
    # Password was already None (set by initiate recovery), recovery_hash stays
    assert user.recovery_hash is not None


@then(parsers.parse('the tokens of "{username}" are revoked'))
def then_tokens_revoked(ctx, username):
    user_id = _user_name_to_id(username)
    mock_revoke = ctx.get("_mock_revoke")
    mock_guard = ctx.get("_mock_guard")
    assert mock_revoke is not None
    mock_revoke.assert_awaited_once_with(user_id)
    mock_guard.revoke_user_tokens.assert_called_once_with(user_id)


@then('no tokens are revoked')
def then_no_tokens_revoked(ctx):
    mock_revoke = ctx.get("_mock_revoke")
    mock_guard = ctx.get("_mock_guard")
    assert mock_revoke is not None
    mock_revoke.assert_not_awaited()
    mock_guard.revoke_user_tokens.assert_not_called()


@then(parsers.parse('a WebSocket "{event_type}" event is broadcast for "{username}"'))
def then_ws_event_broadcasted(ctx, event_type, username):
    user_id = _user_name_to_id(username)
    assert len(ctx["ws"].broadcasts) >= 1
    broadcast = ctx["ws"].broadcasts[-1]
    assert broadcast["message"]["type"] == event_type
    assert broadcast["message"]["data"]["user_id"] == user_id


@then('the recovery_hash in the database is the SHA-256 of the returned passphrase')
def then_hash_matches_passphrase(ctx):
    response = ctx["responses"][-1]
    passphrase = response.body["recovery_passphrase"]
    expected_hash = hashlib.sha256(passphrase.encode()).hexdigest()

    loop = ctx["loop"]
    user = _run(loop, ctx["repo"].get_user_by_id(MEMBER_ID))
    assert user.recovery_hash == expected_hash


@then('the second passphrase is different from the first')
def then_passphrases_differ(ctx):
    assert len(ctx["passphrases"]) >= 2
    assert ctx["passphrases"][0] != ctx["passphrases"][1]


@then('the database contains the hash of the second passphrase')
def then_db_has_second_hash(ctx):
    expected_hash = hashlib.sha256(ctx["passphrases"][1].encode()).hexdigest()
    loop = ctx["loop"]
    user = _run(loop, ctx["repo"].get_user_by_id(MEMBER_ID))
    assert user.recovery_hash == expected_hash


@then(parsers.parse('"{username}" has the new password "{password}"'))
def then_user_has_new_password(ctx, username, password):
    user_id = _user_name_to_id(username)
    loop = ctx["loop"]
    user = _run(loop, ctx["repo"].get_user_by_id(user_id))
    assert user.password_hash is not None
    assert bcrypt.checkpw(password.encode(), user.password_hash.encode())


@then('the recovery fields are cleared in the database')
def then_recovery_cleared(ctx):
    loop = ctx["loop"]
    user = _run(loop, ctx["repo"].get_user_by_id(MEMBER_ID))
    assert user.recovery_hash is None
    assert user.recovery_expires_at is None


@then('the recovery state remains in the database')
def then_recovery_remains(ctx):
    loop = ctx["loop"]
    user = _run(loop, ctx["repo"].get_user_by_id(MEMBER_ID))
    assert user.recovery_hash is not None


@then('the third attempt returns status 200')
def then_third_attempt_200(ctx):
    response = ctx["responses"][-1]
    assert response.status_code == 200


@then('the second attempt returns None')
def then_second_attempt_none(ctx):
    assert ctx["responses"][-1] is None


@then(parsers.parse('the old password of "{username}" no longer works'))
def then_old_password_fails(ctx, username):
    user_id = _user_name_to_id(username)
    loop = ctx["loop"]
    user = _run(loop, ctx["repo"].get_user_by_id(user_id))
    assert not bcrypt.checkpw(MEMBER_PASSWORD.encode(), user.password_hash.encode())
