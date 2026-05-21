# Multi-Room Voice Support for Microcord

## Goal
Add multi-room voice channel support to Microcord with admin control, session-level restrictions, screenshare limiting, and configurable default channel.

## Current Context / Assumptions
- Frontend: React/TypeScript (dev: port 5173, prod: port 8000/8443)
- Backend: Python (FastAPI likely, based on :8000/:8443 pattern)
- Admin setup modal exists with tabs
- WebSocket events exist for room updates (to be reused/expanded)
- User roles: owner, admin, regular user
- Current voice implementation is single-room (one voice room per microcord instance)
- Microcord is a single-server system (no multi-tenant server_id concept)

## Proposed Approach
1. **Data Model Extensions**: Add VoiceChannel entity (global to microcord)
2. **Backend API**: CRUD endpoints for voice channels, session tracking
3. **Frontend UI**: Admin tab for managing channels, channel list/join UI
4. **Session Enforcement**: One active voice channel per session (user-device pair)
5. **Screenshare Limiting**: One active screenshare per channel
6. **WebSocket Events**: Extend existing room update events to include voice channel changes
7. **Environment Config**: Add DEFAULT_VOICE_CHANNEL_NAME to env vars
8. **Integration Tests**: Gherkin scenarios for critical workflows

## Step-by-Step Plan

### Phase 1: Backend Data Model & Config

**Files to create:**
- `backend/models/voice_channel.py` - VoiceChannel model with typing
- `backend/constants/voice.py` - Voice-related constants (max name length, etc.)

**Files to modify:**
- `backend/models/user_session.py` - Add active_voice_channel_id field
- `backend/models/voice_state.py` - Add channel_id, screenshare_user_id fields
- `.env.example` - Add DEFAULT_VOICE_CHANNEL_NAME

**Implementation:**
```python
# backend/models/voice_channel.py
class VoiceChannel(Base):
    __tablename__ = "voice_channels"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(24))  # Max 24 chars
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    voice_states: Mapped[List["VoiceState"]] = relationship(back_populates="channel")

# backend/constants/voice.py
MAX_VOICE_CHANNEL_NAME_LENGTH = 24
DEFAULT_VOICE_CHANNEL_NAME = "General"
```

### Phase 2: Backend API Handlers

**Files to create:**
- `backend/api/handlers/voice_channel.py` - Voice channel CRUD handlers
- `backend/api/handlers/voice_state.py` - Join/leave voice, screenshare handlers

**Files to modify:**
- `backend/api/router.py` - Register new voice channel routes

**Endpoints:**
```
POST   /api/voice-channels  # Create (admin/owner only)
GET    /api/voice-channels  # List all
DELETE /api/voice-channels/{channel_id}  # Delete (admin/owner only)
POST   /api/voice-channels/{channel_id}/join  # Join channel
POST   /api/voice-channels/{channel_id}/leave  # Leave channel
POST   /api/voice-channels/{channel_id}/screenshare  # Toggle screenshare
```

**Business Logic:**
- Create/Delete: Verify user is owner or admin
- Join: Check session-level restriction (leave current channel first if in one)
- Screenshare: Check if another user is already screensharing in channel

### Phase 3: WebSocket Events (Reuse & Extend)

**Files to modify:**
- `backend/websocket/events.py` - Extend existing room update events

**Events to emit:**
```python
VOICE_CHANNELS_UPDATED = "voice_channels_updated"
VOICE_STATE_UPDATED = "voice_state_updated"
VOICE_SCREENSHARE_TOGGLED = "voice_screenshare_toggled"
```

**Payload structure:**
```python
{
  "voice_channels": [
    {
      "id": int,
      "name": str,
      "participant_count": int
    }
  ]
}
```

### Phase 4: Frontend - Admin Tab

**Files to create:**
- `frontend/src/components/admin/VoiceChannelManager.tsx` - Admin voice channel management
- `frontend/src/components/admin/VoiceChannelForm.tsx` - Form for creating channels

**Files to modify:**
- `frontend/src/components/admin/AdminSetupModal.tsx` - Add voice channels tab
- `frontend/src/hooks/useVoiceChannels.ts` - Custom hook for voice channel API

**UI Components:**
- List view of existing channels with delete button
- Create button with name input (max 24 chars, real-time validation)
- Delete confirmation modal

### Phase 5: Frontend - Voice Channel List & Join

**Files to create:**
- `frontend/src/components/voice/VoiceChannelList.tsx` - List of joinable channels
- `frontend/src/components/voice/VoiceChannelItem.tsx` - Single channel item

**Files to modify:**
- `frontend/src/components/voice/VoicePanel.tsx` - Integrate channel list
- `frontend/src/context/VoiceContext.tsx` - Add current_channel tracking

**Interaction:**
- Click on channel → join
- Show active channel visually distinct
- Show participant count
- Disable join if already in another channel

### Phase 6: Frontend - Screenshare UI

**Files to modify:**
- `frontend/src/components/voice/VoicePanel.tsx` - Add screenshare toggle per channel
- `frontend/src/hooks/useVoiceScreenshare.ts` - Custom hook for screenshare API

**Logic:**
- Only show screenshare button if no one else is screensharing in current channel
- Show visual indicator when screensharing is active in channel

### Phase 7: Environment Config

**Files to modify:**
- `.env.example` - Add `DEFAULT_VOICE_CHANNEL_NAME=General`
- `backend/config.py` - Read env var for default channel name
- `backend/app.py` or `backend/main.py` - Create default voice channel on app startup

### Phase 8: Integration Tests (Gherkin)

**Files to create:**
- `backend/tests/features/voice_channels.feature` - Gherkin scenarios
- `backend/tests/steps/voice_channels_steps.py` - Step definitions

**Gherkin Scenarios:**

```gherkin
Feature: Voice Channel Management
  As an admin or owner
  I want to create and delete voice channels
  So that users can join different voice rooms

  Scenario: Admin creates a voice channel
    Given I am an admin
    When I create a voice channel named "Lounge"
    Then the channel should be created with name "Lounge"

  Scenario: Regular user cannot create voice channel
    Given I am a regular user
    When I attempt to create a voice channel
    Then I should receive a 403 Forbidden error

  Scenario: Admin deletes a voice channel
    Given I am an admin
    And a voice channel "Lounge" exists
    When I delete the voice channel "Lounge"
    Then the channel should be removed

Feature: Voice Channel Join Restrictions
  As a user
  I want to only be in one voice channel per session
  So that my voice state is consistent

  Scenario: User joins voice channel
    Given voice channels "General" and "Lounge" exist
    And I have a session
    And I am not in any voice channel
    When I join "General"
    Then I should be in "General"

  Scenario: User switches voice channels
    Given voice channels "General" and "Lounge" exist
    And I have a session
    And I am in "General"
    When I join "Lounge"
    Then I should leave "General"
    And I should be in "Lounge"

  Scenario: User cannot be in multiple channels from different sessions
    Given voice channels "General" and "Lounge" exist
    And I have session A
    And I have session B
    And I am in "General" from session A
    When I attempt to join "Lounge" from session B
    Then I should receive a 400 Bad Request error

Feature: Screenshare Restrictions
  As a user
  I want only one screenshare per channel
  So that screensharing is not chaotic

  Scenario: User starts screenshare in channel
    Given voice channel "General" exists
    And I am in "General"
    And no one is screensharing in "General"
    When I start screenshare
    Then I should be screensharing

  Scenario: Second user cannot screenshare in same channel
    Given voice channel "General" exists
    And user Alice is in "General" and screensharing
    And I am in "General"
    When I attempt to start screenshare
    Then I should receive a 409 Conflict error

  Scenario: User starts screenshare in another channel
    Given voice channels "General" and "Lounge" exist
    And user Alice is in "General" and screensharing
    And I am in "Lounge"
    When I start screenshare
    Then I should be screensharing in "Lounge"
```

**Test Implementation:**
- Use top-level API handler testing (as per Pedro's preference)
- Fake classes for WS manager with history list
- Real DB transactions, rolled back after each test

### Phase 9: Constant Extraction & Typing

**Files to create:**
- `backend/constants/voice.py` - Already created in Phase 1
- `frontend/src/constants/voice.ts` - Frontend voice constants

**Content:**
```typescript
// frontend/src/constants/voice.ts
export const MAX_VOICE_CHANNEL_NAME_LENGTH = 24;
export const DEFAULT_VOICE_CHANNEL_NAME = "General";
```

**Typing:**
- Add TypeScript interfaces for VoiceChannel, VoiceState
- Use strict typing throughout frontend

## Files Likely to Change

### Backend
- `backend/models/user_session.py`
- `backend/models/voice_state.py`
- `backend/api/router.py`
- `backend/websocket/events.py`
- `backend/config.py`
- `backend/app.py` or `backend/main.py`
- `.env.example`

### New Backend Files
- `backend/models/voice_channel.py`
- `backend/constants/voice.py`
- `backend/api/handlers/voice_channel.py`
- `backend/api/handlers/voice_state.py`
- `backend/tests/features/voice_channels.feature`
- `backend/tests/steps/voice_channels_steps.py`

### Frontend
- `frontend/src/components/admin/AdminSetupModal.tsx`
- `frontend/src/components/voice/VoicePanel.tsx`
- `frontend/src/context/VoiceContext.tsx`

### New Frontend Files
- `frontend/src/components/admin/VoiceChannelManager.tsx`
- `frontend/src/components/admin/VoiceChannelForm.tsx`
- `frontend/src/components/voice/VoiceChannelList.tsx`
- `frontend/src/components/voice/VoiceChannelItem.tsx`
- `frontend/src/hooks/useVoiceChannels.ts`
- `frontend/src/hooks/useVoiceScreenshare.ts`
- `frontend/src/constants/voice.ts`

## Tests / Validation

### Unit Tests
- VoiceChannel model validation (name length, etc.)
- Permission checks (owner/admin only for create/delete)
- Session-level restriction logic
- Screenshare limiting logic

### Integration Tests (Gherkin)
- Voice channel CRUD by admin/owner
- Permission rejection for regular users
- Join/leave channel flows
- Session-level restrictions
- Screenshare restrictions

### Manual Validation
- Admin can create/delete channels via admin tab
- Users can join channels by clicking
- Session restriction works (different devices)
- Only one screenshare per channel
- Default channel created on app startup
- WebSocket events propagate channel changes

## Risks, Tradeoffs, and Open Questions

### Risks
1. **Session identification**: Need reliable way to distinguish user sessions (device vs browser tab). Are we using session_id from UserSession model?
2. **Migration path**: Existing instances won't have a default voice channel. Need migration or auto-creation on startup.
3. **Concurrent joins**: Race conditions if two users try to screenshare simultaneously. Use database locking.

### Tradeoffs
1. **One screenshare per channel**: Simplifies UX but limits use cases. Could be relaxed later.
2. **Max 24 char name**: Short limit but keeps UI clean. Can be adjusted if needed.
3. **Admin/owner only**: Centralized control. Could add permissions system later.

### Open Questions
1. **Session tracking**: Is there already a UserSession model with session_id? If not, how to track sessions?
2. **Voice server integration**: Does microcord use a separate voice server (e.g., Mediasoup) or is it peer-to-peer? This affects state management.
3. **Channel reordering**: Should channels have an order field? Or just sort by created_at?
4. **Channel permissions**: Should there be per-channel permissions (e.g., "private" channels)? Keeping it simple for now.

## Verification Steps

1. Start microcord → verify default voice channel "General" exists
2. As admin, create channel "Lounge" → verify appears in list
3. As regular user, try to create channel → verify 403 error
4. Join "General" → verify in channel
5. Join "Lounge" from same session → verify left "General", in "Lounge"
6. Open browser in incognito, try to join another channel → verify error (session restriction)
7. Start screenshare → verify screensharing
8. Another user tries to screenshare in same channel → verify 409 error
9. Delete "Lounge" as admin → verify removed from list
10. Verify WebSocket events fire for all channel operations
11. Run integration tests → all pass