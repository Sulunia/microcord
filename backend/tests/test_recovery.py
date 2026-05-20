"""Tests for the account recovery API flow — top-level integration.

Tests call the actual API handler functions (recover_account, _try_account_recovery)
with a real test database and verify both the HTTP response and the final DB state.

The only things mocked are Connexion/Starlette request context (since there's no
real HTTP server) and the WebSocket manager broadcast (no WS clients).
"""

import hashlib
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock, AsyncMock

import pytest
import pytest_asyncio

from conftest import (
    OWNER_ID, MEMBER_ID, SECOND_MEMBER_ID,
    OWNER_NAME, MEMBER_NAME, SECOND_MEMBER_NAME,
    OWNER_PASSWORD, MEMBER_PASSWORD,
    VALID_RECOVERY_PASSPHRASE, VALID_RECOVERY_HASH,
    EXPIRED_RECOVERY_PASSPHRASE, EXPIRED_RECOVERY_HASH,
    _hash_password,
)


# ── Shared patch helpers ─────────────────────────────────────────

def _mock_ws_manager():
    """Create a mock ws_manager with an async broadcast method."""
    mock = MagicMock()
    mock.broadcast = AsyncMock()
    return mock


# ── recover_account (POST /api/users/{user_id}/recover) ─────────

class TestRecoverAccountInitiation:
    """Tests for api.users.recover_account — initiating recovery.

    This is the endpoint an admin/owner calls to generate a recovery
    passphrase for a user.
    """

    @pytest.mark.asyncio
    async def test_owner_can_initiate_recovery_for_member(self, test_repo):
        """Owner initiating recovery for a member should return a passphrase and set recovery state in DB."""
        from api import users as users_mod
        from services import auth as auth_mod

        mock_ws = _mock_ws_manager()

        with patch.object(users_mod, "repo", test_repo), \
             patch.object(users_mod, "ws_manager", mock_ws), \
             patch.object(users_mod, "current_user_is_owner", return_value=True), \
             patch.object(users_mod, "current_user_id", return_value=OWNER_ID), \
             patch.object(auth_mod, "repo", test_repo), \
             patch.object(users_mod, "revoke_all_refresh_tokens", new_callable=AsyncMock):

            response = await users_mod.recover_account(MEMBER_ID)

        assert response.status_code == 200
        body = response.body
        assert "recovery_passphrase" in body
        assert len(body["recovery_passphrase"]) == 10  # RECOVERY_PASSPHRASE_LENGTH
        assert body["expires_at"] is not None

        # Verify DB state: member should have recovery_hash set and password cleared
        user = await test_repo.get_user_by_id(MEMBER_ID)
        assert user.recovery_hash is not None
        assert user.recovery_expires_at is not None
        assert user.password_hash is None

    @pytest.mark.asyncio
    async def test_owner_self_recovery_has_no_expiry(self, test_repo):
        """When owner recovers their own account, expiry should be None (no time limit)."""
        from api import users as users_mod
        from services import auth as auth_mod

        mock_ws = _mock_ws_manager()

        with patch.object(users_mod, "repo", test_repo), \
             patch.object(users_mod, "ws_manager", mock_ws), \
             patch.object(users_mod, "current_user_is_owner", return_value=True), \
             patch.object(users_mod, "current_user_id", return_value=OWNER_ID), \
             patch.object(auth_mod, "repo", test_repo):

            response = await users_mod.recover_account(OWNER_ID)

        assert response.status_code == 200
        assert response.body["expires_at"] is None

        # DB: owner has recovery_hash but no expiry
        user = await test_repo.get_user_by_id(OWNER_ID)
        assert user.recovery_hash is not None
        assert user.recovery_expires_at is None
        assert user.password_hash is None

    @pytest.mark.asyncio
    async def test_non_owner_cannot_initiate_recovery(self, test_repo):
        """Non-owner should get 403 when trying to initiate recovery."""
        from api import users as users_mod

        with patch.object(users_mod, "repo", test_repo), \
             patch.object(users_mod, "current_user_is_owner", return_value=False), \
             patch.object(users_mod, "current_user_id", return_value=MEMBER_ID):

            response = await users_mod.recover_account(SECOND_MEMBER_ID)

        assert response.status_code == 403
        assert "Owner access required" in response.body["error"]

        # DB should be unchanged — no recovery set
        user = await test_repo.get_user_by_id(SECOND_MEMBER_ID)
        assert user.recovery_hash is None
        assert user.password_hash is not None

    @pytest.mark.asyncio
    async def test_recovery_for_nonexistent_user_returns_404(self, test_repo):
        """Trying to recover a user that doesn't exist should return 404."""
        from api import users as users_mod

        fake_id = "00000000-0000-0000-0000-000000000999"

        with patch.object(users_mod, "repo", test_repo), \
             patch.object(users_mod, "current_user_is_owner", return_value=True), \
             patch.object(users_mod, "current_user_id", return_value=OWNER_ID):

            response = await users_mod.recover_account(fake_id)

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_recovery_revokes_tokens_for_other_user(self, test_repo):
        """When recovering another user, their refresh tokens should be revoked."""
        from api import users as users_mod
        from services import auth as auth_mod

        mock_ws = _mock_ws_manager()

        with patch.object(users_mod, "repo", test_repo), \
             patch.object(users_mod, "ws_manager", mock_ws), \
             patch.object(users_mod, "current_user_is_owner", return_value=True), \
             patch.object(users_mod, "current_user_id", return_value=OWNER_ID), \
             patch.object(auth_mod, "repo", test_repo), \
             patch.object(users_mod, "revoke_all_refresh_tokens", new_callable=AsyncMock) as mock_revoke, \
             patch.object(users_mod, "guard") as mock_guard:

            response = await users_mod.recover_account(MEMBER_ID)

        assert response.status_code == 200
        # Tokens should have been revoked for the target user, not self
        mock_revoke.assert_awaited_once_with(MEMBER_ID)
        mock_guard.revoke_user_tokens.assert_called_once_with(MEMBER_ID)

    @pytest.mark.asyncio
    async def test_self_recovery_does_not_revoke_tokens(self, test_repo):
        """When recovering own account, tokens should NOT be revoked."""
        from api import users as users_mod
        from services import auth as auth_mod

        mock_ws = _mock_ws_manager()

        with patch.object(users_mod, "repo", test_repo), \
             patch.object(users_mod, "ws_manager", mock_ws), \
             patch.object(users_mod, "current_user_is_owner", return_value=True), \
             patch.object(users_mod, "current_user_id", return_value=OWNER_ID), \
             patch.object(auth_mod, "repo", test_repo), \
             patch.object(users_mod, "revoke_all_refresh_tokens", new_callable=AsyncMock) as mock_revoke, \
             patch.object(users_mod, "guard") as mock_guard:

            response = await users_mod.recover_account(OWNER_ID)

        assert response.status_code == 200
        mock_revoke.assert_not_awaited()
        mock_guard.revoke_user_tokens.assert_not_called()

    @pytest.mark.asyncio
    async def test_recovery_broadcasts_user_updated_via_ws(self, test_repo):
        """Recovery should broadcast a user_updated WS event."""
        from api import users as users_mod
        from services import auth as auth_mod

        mock_ws = _mock_ws_manager()

        with patch.object(users_mod, "repo", test_repo), \
             patch.object(users_mod, "ws_manager", mock_ws), \
             patch.object(users_mod, "current_user_is_owner", return_value=True), \
             patch.object(users_mod, "current_user_id", return_value=OWNER_ID), \
             patch.object(auth_mod, "repo", test_repo), \
             patch.object(users_mod, "revoke_all_refresh_tokens", new_callable=AsyncMock):

            await users_mod.recover_account(MEMBER_ID)

        mock_ws.broadcast.assert_awaited_once()
        broadcast_data = mock_ws.broadcast.call_args[0][0]
        assert broadcast_data["type"] == "user_updated"
        assert broadcast_data["data"]["user_id"] == MEMBER_ID

    @pytest.mark.asyncio
    async def test_recovery_passphrase_hashes_correctly_in_db(self, test_repo):
        """The passphrase returned should SHA-256 match what's stored in the DB."""
        from api import users as users_mod
        from services import auth as auth_mod

        mock_ws = _mock_ws_manager()

        with patch.object(users_mod, "repo", test_repo), \
             patch.object(users_mod, "ws_manager", mock_ws), \
             patch.object(users_mod, "current_user_is_owner", return_value=True), \
             patch.object(users_mod, "current_user_id", return_value=OWNER_ID), \
             patch.object(auth_mod, "repo", test_repo), \
             patch.object(users_mod, "revoke_all_refresh_tokens", new_callable=AsyncMock):

            response = await users_mod.recover_account(MEMBER_ID)

        passphrase = response.body["recovery_passphrase"]
        expected_hash = hashlib.sha256(passphrase.encode()).hexdigest()

        user = await test_repo.get_user_by_id(MEMBER_ID)
        assert user.recovery_hash == expected_hash

    @pytest.mark.asyncio
    async def test_re_initiating_recovery_replaces_old_passphrase(self, test_repo):
        """Calling recover_account twice should generate a new passphrase each time."""
        from api import users as users_mod
        from services import auth as auth_mod

        mock_ws = _mock_ws_manager()

        with patch.object(users_mod, "repo", test_repo), \
             patch.object(users_mod, "ws_manager", mock_ws), \
             patch.object(users_mod, "current_user_is_owner", return_value=True), \
             patch.object(users_mod, "current_user_id", return_value=OWNER_ID), \
             patch.object(auth_mod, "repo", test_repo), \
             patch.object(users_mod, "revoke_all_refresh_tokens", new_callable=AsyncMock):

            r1 = await users_mod.recover_account(MEMBER_ID)
            r2 = await users_mod.recover_account(MEMBER_ID)

        assert r1.body["recovery_passphrase"] != r2.body["recovery_passphrase"]

        # DB should have the latest hash
        user = await test_repo.get_user_by_id(MEMBER_ID)
        expected_hash = hashlib.sha256(r2.body["recovery_passphrase"].encode()).hexdigest()
        assert user.recovery_hash == expected_hash


# ── _try_account_recovery (used in register flow) ───────────────

class TestTryAccountRecovery:
    """Tests for api.auth._try_account_recovery — completing recovery via register.

    When a user has a pending recovery, they use the register endpoint with
    their recovery passphrase instead of the server passphrase. This function
    is called internally by register().
    """

    @pytest.mark.asyncio
    async def test_successful_recovery_returns_200_with_tokens(self, seeded_repo_with_pending_recovery):
        """Valid recovery passphrase + new password should return 200 with access/refresh tokens."""
        from api import auth as auth_mod
        from services import auth as auth_svc

        with patch.object(auth_mod, "repo", seeded_repo_with_pending_recovery), \
             patch.object(auth_svc, "repo", seeded_repo_with_pending_recovery):

            response = await auth_mod._try_account_recovery(
                MEMBER_NAME, "brand_new_password", VALID_RECOVERY_PASSPHRASE
            )

        assert response is not None
        assert response.status_code == 200
        body = response.body
        assert "access_token" in body
        assert "refresh_token" in body
        assert body["user"]["name"] == MEMBER_NAME

    @pytest.mark.asyncio
    async def test_successful_recovery_updates_password_in_db(self, seeded_repo_with_pending_recovery):
        """After recovery, the DB should have the new bcrypt password and cleared recovery fields."""
        import bcrypt
        from api import auth as auth_mod
        from services import auth as auth_svc

        new_password = "brand_new_password"
        with patch.object(auth_mod, "repo", seeded_repo_with_pending_recovery), \
             patch.object(auth_svc, "repo", seeded_repo_with_pending_recovery):

            await auth_mod._try_account_recovery(
                MEMBER_NAME, new_password, VALID_RECOVERY_PASSPHRASE
            )

        user = await seeded_repo_with_pending_recovery.get_user_by_id(MEMBER_ID)
        assert user.password_hash is not None
        assert user.recovery_hash is None
        assert user.recovery_expires_at is None
        # Verify the new password actually works with bcrypt
        assert bcrypt.checkpw(new_password.encode(), user.password_hash.encode())

    @pytest.mark.asyncio
    async def test_recovery_returns_none_for_user_without_pending_recovery(self, test_repo):
        """A user with no pending recovery should cause _try_account_recovery to return None."""
        from api import auth as auth_mod

        with patch.object(auth_mod, "repo", test_repo):

            result = await auth_mod._try_account_recovery(
                OWNER_NAME, OWNER_PASSWORD, "any_passphrase"
            )

        assert result is None

    @pytest.mark.asyncio
    async def test_recovery_returns_none_for_nonexistent_user(self, test_repo):
        """A user that doesn't exist should cause _try_account_recovery to return None."""
        from api import auth as auth_mod

        with patch.object(auth_mod, "repo", test_repo):

            result = await auth_mod._try_account_recovery(
                "ghost_user", "password", "any_passphrase"
            )

        assert result is None

    @pytest.mark.asyncio
    async def test_expired_recovery_passphrase_returns_403(self, seeded_repo_with_expired_recovery):
        """An expired recovery passphrase should return 403 with clear error."""
        from api import auth as auth_mod

        with patch.object(auth_mod, "repo", seeded_repo_with_expired_recovery):

            response = await auth_mod._try_account_recovery(
                MEMBER_NAME, "new_password", EXPIRED_RECOVERY_PASSPHRASE
            )

        assert response is not None
        assert response.status_code == 403
        assert "expired" in response.body["error"].lower()

    @pytest.mark.asyncio
    async def test_wrong_recovery_passphrase_returns_403(self, seeded_repo_with_pending_recovery):
        """A wrong passphrase (hash mismatch) should return 403."""
        from api import auth as auth_mod

        with patch.object(auth_mod, "repo", seeded_repo_with_pending_recovery):

            response = await auth_mod._try_account_recovery(
                MEMBER_NAME, "new_password", "TOTALLY_WRONG_PASSPHRASE"
            )

        assert response is not None
        assert response.status_code == 403
        assert "invalid" in response.body["error"].lower()

        # DB should be unchanged — recovery still pending
        user = await seeded_repo_with_pending_recovery.get_user_by_id(MEMBER_ID)
        assert user.recovery_hash is not None
        assert user.password_hash is None

    @pytest.mark.asyncio
    async def test_wrong_passphrase_does_not_consume_recovery(self, seeded_repo_with_pending_recovery):
        """Failed recovery attempts should NOT clear the recovery state — user can retry."""
        from api import auth as auth_mod

        with patch.object(auth_mod, "repo", seeded_repo_with_pending_recovery), \
             patch.object(auth_mod, "create_refresh_token", new_callable=AsyncMock, return_value="mock_refresh_token"):

            # First wrong attempt
            r1 = await auth_mod._try_account_recovery(
                MEMBER_NAME, "new_pass", "WRONG"
            )
            assert r1.status_code == 403

            # Second wrong attempt — should still work (not consumed)
            r2 = await auth_mod._try_account_recovery(
                MEMBER_NAME, "new_pass", "ALSO_WRONG"
            )
            assert r2.status_code == 403

            # Correct attempt — should still succeed
            r3 = await auth_mod._try_account_recovery(
                MEMBER_NAME, "final_password", VALID_RECOVERY_PASSPHRASE
            )
            assert r3.status_code == 200

    @pytest.mark.asyncio
    async def test_successful_recovery_cannot_be_reused(self, seeded_repo_with_pending_recovery):
        """After a successful recovery, the recovery fields are cleared —
        calling _try_account_recovery again should return None."""
        from api import auth as auth_mod
        from services import auth as auth_svc

        with patch.object(auth_mod, "repo", seeded_repo_with_pending_recovery), \
             patch.object(auth_svc, "repo", seeded_repo_with_pending_recovery):

            # First call — success
            r1 = await auth_mod._try_account_recovery(
                MEMBER_NAME, "new_password", VALID_RECOVERY_PASSPHRASE
            )
            assert r1.status_code == 200

            # Second call with same passphrase — should return None (no recovery pending)
            r2 = await auth_mod._try_account_recovery(
                MEMBER_NAME, "another_password", VALID_RECOVERY_PASSPHRASE
            )
            assert r2 is None


# ── Full end-to-end flow ────────────────────────────────────────

class TestRecoveryEndToEnd:
    """Full flow: initiate recovery -> use passphrase to recover -> verify DB clean."""

    @pytest.mark.asyncio
    async def test_full_owner_initiates_member_recovers(self, test_repo):
        """Owner initiates recovery for member, member uses passphrase to set new password."""
        import bcrypt
        from api import users as users_mod
        from api import auth as auth_mod
        from services import auth as auth_svc

        mock_ws = _mock_ws_manager()

        # Step 1: Owner initiates recovery for member
        with patch.object(users_mod, "repo", test_repo), \
             patch.object(users_mod, "ws_manager", mock_ws), \
             patch.object(users_mod, "current_user_is_owner", return_value=True), \
             patch.object(users_mod, "current_user_id", return_value=OWNER_ID), \
             patch.object(auth_svc, "repo", test_repo), \
             patch.object(users_mod, "revoke_all_refresh_tokens", new_callable=AsyncMock):

            init_response = await users_mod.recover_account(MEMBER_ID)

        assert init_response.status_code == 200
        passphrase = init_response.body["recovery_passphrase"]

        # Verify member is in recovery state
        member = await test_repo.get_user_by_id(MEMBER_ID)
        assert member.recovery_hash is not None
        assert member.password_hash is None

        # Step 2: Member uses the passphrase to recover
        new_password = "my_brand_new_secure_password"
        with patch.object(auth_mod, "repo", test_repo), \
             patch.object(auth_svc, "repo", test_repo):

            recover_response = await auth_mod._try_account_recovery(
                MEMBER_NAME, new_password, passphrase
            )

        assert recover_response.status_code == 200
        assert "access_token" in recover_response.body

        # Step 3: Verify DB is clean — new password set, recovery cleared
        member = await test_repo.get_user_by_id(MEMBER_ID)
        assert member.recovery_hash is None
        assert member.recovery_expires_at is None
        assert member.password_hash is not None
        assert bcrypt.checkpw(new_password.encode(), member.password_hash.encode())

        # Step 4: Old password should NOT work anymore
        assert not bcrypt.checkpw(MEMBER_PASSWORD.encode(), member.password_hash.encode())
