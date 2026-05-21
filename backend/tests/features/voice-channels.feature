Feature: Multi-room voice channels

  As a server admin
  I want to create, list, and delete voice channels
  So users can join different voice rooms simultaneously

  Background:
    Given the database has owner "owner_user" and member "member_alice"
    And a default voice channel "General" exists

  # ── Voice channel CRUD ──────────────────────────────────────────

  Scenario: Admin creates a voice channel successfully
    When "owner_user" creates a voice channel named "Music"
    Then the system returns status 201
    And the response contains a voice channel named "Music"
    And a "voice_channel_created" WebSocket event is broadcast

  Scenario: Non-admin cannot create a voice channel
    When "member_alice" creates a voice channel named "Music"
    Then the system returns status 403 with error "Admin or owner access required"

  Scenario: Unauthenticated user cannot create a voice channel
    When an unauthenticated user creates a voice channel named "Music"
    Then the system returns status 401 with error "Not authenticated"

  Scenario: Voice channel name must be 1-24 characters
    When "owner_user" creates a voice channel with an empty name
    Then the system returns status 400 with error "Name must be 1-24 characters"

  Scenario: Voice channel name cannot exceed 24 characters
    When "owner_user" creates a voice channel with a name exceeding 24 characters
    Then the system returns status 400 with error "Name must be 1-24 characters"

  Scenario: Duplicate voice channel name returns 409
    When "owner_user" creates a voice channel named "General"
    Then the system returns status 409 with error "Voice channel name already exists"

  Scenario: List voice channels returns all channels
    When "owner_user" creates a voice channel named "Gaming"
    And the system lists all voice channels
    Then the response contains at least 2 voice channels
    And each voice channel has an id field
    And each channel listing includes participant count

  Scenario: Admin deletes a voice channel successfully
    When "owner_user" creates a voice channel named "ToDelete"
    And "owner_user" deletes the voice channel "ToDelete"
    Then the system returns status 200
    And a "voice_channel_deleted" WebSocket event is broadcast

  Scenario: Cannot delete the last voice channel
    When "owner_user" deletes the voice channel "General"
    Then the system returns status 400 with error "Cannot delete the last voice channel"

  Scenario: Deleting a nonexistent voice channel returns 404
    Given "owner_user" creates a voice channel named "Extra"
    When "owner_user" deletes a nonexistent voice channel
    Then the system returns status 404 with error "Voice channel not found"

  Scenario: Non-admin cannot delete a voice channel
    When "member_alice" deletes the voice channel "General"
    Then the system returns status 403 with error "Admin or owner access required"

  # ── Voice room manager (in-memory) ──────────────────────────────

  Scenario: User joins a voice channel
    When "member_alice" joins voice channel "General" with connection "conn1"
    Then "member_alice" is in voice channel "General"
    And the voice room for "General" has 1 participant
    And a "voice_participant_joined" WebSocket event is broadcast with channel_id "General"

  Scenario: User leaves a voice channel
    Given "member_alice" is in voice channel "General"
    When "member_alice" leaves voice
    Then "member_alice" is not in any voice channel
    And a "voice_participant_left" WebSocket event is broadcast

  Scenario: User can switch voice channels via VoiceRoomManager
    Given "member_alice" is in voice channel "General"
    And "owner_user" creates a voice channel named "Gaming"
    When "member_alice" switches to voice channel "Gaming"
    Then "member_alice" is in voice channel "Gaming"
    And the voice room for "General" has 0 participant
    And the voice room for "Gaming" has 1 participant

  Scenario: User cannot join voice twice on same channel
    Given "member_alice" is in voice channel "General"
    When "member_alice" tries to join voice again on channel "General"
    Then the system returns status 409

  Scenario: VoiceRoomManager tracks multiple users across channels
    Given "member_alice" is in voice channel "General"
    And "owner_user" creates a voice channel named "Music"
    When "owner_user" joins voice channel "Music" with connection "conn2"
    Then "member_alice" is in voice channel "General"
    And "owner_user" is in voice channel "Music"

  Scenario: Removing a room evicts all participants
    Given "member_alice" joins voice channel "General" with connection "conn1"
    And "owner_user" joins voice channel "General" with connection "conn2"
    When the voice room manager removes room "General"
    Then "member_alice" is not in any voice channel
    And "owner_user" is not in any voice channel

  Scenario: Deleting a voice channel evicts in-memory participants
    Given "owner_user" creates a voice channel named "Temp"
    And "member_alice" is in voice channel "Temp"
    When "owner_user" deletes the voice channel "Temp"
    Then "member_alice" is not in any voice channel

  # ── Default voice channel migration ────────────────────────────

  Scenario: Default voice channel is created on first startup
    Given a fresh database with no voice channels
    When the system migrates the default voice channel
    Then the database has exactly 1 voice channel named "General"

  Scenario: Default migration is idempotent
    When the system migrates the default voice channel
    Then the database has exactly 1 voice channel named "General"

  # ── Max voice channels limit ────────────────────────────────────

  Scenario: Cannot exceed max voice channels
    Given the database has 19 voice channels
    When "owner_user" creates a voice channel named "Channel20"
    Then the system returns status 201
    When "owner_user" creates a voice channel named "Channel21"
    Then the system returns status 400 with error "Maximum voice channels reached"
