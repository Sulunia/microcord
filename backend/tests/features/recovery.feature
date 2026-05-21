Feature: Account recovery via passphrase

  As the server owner
  I want to initiate account recovery for members
  So they can reset their password using a temporary passphrase

  Background:
    Given the database has owner "owner_user" and member "member_alice"

  # ── Initiate recovery (owner action) ──────────────────────────

  Scenario: Owner initiates recovery for a member successfully
    When "owner_user" initiates recovery for "member_alice"
    Then the system returns status 200 with a passphrase of 10 characters
    And the password of "member_alice" is removed from the database
    And a recovery_hash is set for "member_alice"
    And the recovery of "member_alice" has an expiry date

  Scenario: Owner recovers own account without expiration
    Given the database has owner "owner_user"
    When "owner_user" initiates recovery for own account
    Then the system returns status 200 with a passphrase of 10 characters
    And the owner password is removed from the database
    And a recovery_hash is set for "owner_user"
    And the recovery has no expiry date

  Scenario: Non-owner cannot initiate recovery
    When "member_alice" attempts to initiate recovery for "member_bob"
    Then the system returns status 403 with error "Owner access required"

  Scenario: Recovering a nonexistent user returns 404
    When "owner_user" attempts to recover a nonexistent account
    Then the system returns status 404

  Scenario: Recovery of another user revokes their tokens
    When "owner_user" initiates recovery for "member_alice"
    Then the tokens of "member_alice" are revoked

  Scenario: Self-recovery does not revoke tokens
    Given the database has owner "owner_user"
    When "owner_user" initiates recovery for own account
    Then no tokens are revoked

  Scenario: Recovery broadcasts user_updated event via WebSocket
    When "owner_user" initiates recovery for "member_alice"
    Then a WebSocket "user_updated" event is broadcast for "member_alice"

  Scenario: Passphrase is correctly hashed in the database
    When "owner_user" initiates recovery for "member_alice"
    Then the recovery_hash in the database is the SHA-256 of the returned passphrase

  Scenario: Re-initiating recovery replaces the previous passphrase
    When "owner_user" initiates recovery for "member_alice" twice
    Then the second passphrase is different from the first
    And the database contains the hash of the second passphrase

  # ── Consume recovery (member action) ──────────────────────────

  Scenario: Successful recovery with a valid passphrase
    Given "member_alice" has a valid pending recovery
    When "member_alice" recovers with the correct passphrase and new password "NewSecure123!"
    Then the system returns status 200 with access_token and refresh_token
    And "member_alice" has the new password "NewSecure123!"
    And the recovery fields are cleared in the database

  Scenario: Recovery for a user with no pending recovery returns None
    When the system attempts to recover "member_alice" with an arbitrary passphrase
    Then the result is None

  Scenario: Recovery for a nonexistent user returns None
    When the system attempts to recover "nonexistent_user" with an arbitrary passphrase
    Then the result is None

  Scenario: Expired passphrase is rejected with 403
    Given "member_alice" has an expired pending recovery
    When "member_alice" attempts to recover with the expired passphrase
    Then the system returns status 403 with error containing "expired"
    And the database remains unchanged for "member_alice"

  Scenario: Wrong passphrase is rejected with 403
    Given "member_alice" has a valid pending recovery
    When "member_alice" attempts to recover with passphrase "WRONG"
    Then the system returns status 403 with error containing "invalid"
    And the recovery state remains in the database

  Scenario: Wrong passphrase does not consume the recovery
    Given "member_alice" has a valid pending recovery
    When "member_alice" attempts to recover with wrong passphrase
    And "member_alice" attempts to recover with wrong passphrase again
    And "member_alice" recovers with the correct passphrase and new password "FinallyWorks!"
    Then the third attempt returns status 200

  Scenario: Successful recovery cannot be reused
    Given "member_alice" has a valid pending recovery
    When "member_alice" recovers with the correct passphrase and new password "NewPass999!"
    And the system tries to recover again with the same passphrase
    Then the second attempt returns None

  # ── End-to-end flow ───────────────────────────────────────────

  Scenario: Full flow — owner initiates, member recovers
    When "owner_user" initiates recovery for "member_alice"
    Then the system returns status 200 with a passphrase of 10 characters
    When "member_alice" recovers with the received passphrase and new password "BrandNew2024!"
    Then the system returns status 200 with access_token and refresh_token
    And "member_alice" has the new password "BrandNew2024!"
    And the recovery fields are cleared in the database
    And the old password of "member_alice" no longer works
