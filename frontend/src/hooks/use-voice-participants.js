import { useState, useCallback, useEffect } from 'preact/hooks';
import { API_BASE, SOUND_ENTER_VOICE, SOUND_EXIT_VOICE, VOICE_STATE, NOTIFICATION_VOLUME, VOICE_EXIT_VOLUME } from '../constants.js';
import { authedFetch } from './use-user.js';
import { useRealtime } from './realtime.jsx';
import { playNotification } from './audio-notifications.js';

/**
 * Manages voice participant state and WS subscriptions for
 * participant lifecycle events (join, leave, mute, speaking, etc.).
 *
 * @param {object} options
 * @param {import('preact/hooks').MutableRef<string>} options.joinStateRef — latest joinState
 * @param {string | null} options.userId — current user ID for detecting joinedElsewhere
 * @param {string | null} options.connectionId — current connection ID for detecting joinedElsewhere
 * @param {(userId: string) => void} options.onParticipantLeft — dispose peer for leaving user
 * @param {(fromId: string, signal: object) => void} options.onSignal — apply incoming voice signal
 * @param {() => void} [options.onRefreshScreenshare] — notify screenshare hook
 */
export function useVoiceParticipants({ joinStateRef, userId, connectionId, onParticipantLeft, onSignal }) {
    const [participants, setParticipants] = useState([]);
    const [speakingUsers, setSpeakingUsers] = useState(new Map());
    const [joinedElsewhere, setJoinedElsewhere] = useState(false);

    const { subscribe } = useRealtime();

    /** Fetch the current participant list from the REST API. */
    const fetchParticipants = useCallback(async () => {
        try {
            const response = await authedFetch(`${API_BASE}/voice/participants`);
            if (response.ok) setParticipants(await response.json());
        } catch {}
    }, []);

    useEffect(() => { fetchParticipants(); }, [fetchParticipants]);

    useEffect(() => {
        const unsubs = [
            subscribe('voice_participant_joined', (data) => {
                if (joinStateRef.current === VOICE_STATE.JOINED) {
                    playNotification(SOUND_ENTER_VOICE, NOTIFICATION_VOLUME);
                }
                const isSameUser = data?.user_id === userId;
                const isDifferentConnection = data?.connection_id != null && data.connection_id !== connectionId;
                const isOtherConnectionJoining = isSameUser && isDifferentConnection;
                if (isOtherConnectionJoining) {
                    setJoinedElsewhere(true);
                }
                if (!data?.channel_id || !joinStateRef.current || joinStateRef.current === VOICE_STATE.JOINED) {
                    fetchParticipants();
                }
            }),
            subscribe('voice_participant_left', (data) => {
                if (joinStateRef.current === VOICE_STATE.JOINED) {
                    playNotification(SOUND_EXIT_VOICE, VOICE_EXIT_VOLUME);
                }
                if (data?.user_id === userId) {
                    setJoinedElsewhere(false);
                }
                onParticipantLeft(data.user_id);
                if (!data?.channel_id || !joinStateRef.current || joinStateRef.current === VOICE_STATE.JOINED) {
                    fetchParticipants();
                }
            }),
            subscribe('voice_signal', (data) => {
                if (joinStateRef.current === VOICE_STATE.JOINED) {
                    onSignal(data.from, data.signal);
                }
            }),
            subscribe('voice_mute', (data) => {
                const { user_id: muteUserId, muted } = data;
                setParticipants((prev) =>
                    prev.map((participant) => {
                        const participantId = participant.user_id || participant.id;
                        return participantId === muteUserId ? { ...participant, muted } : participant;
                    }),
                );
            }),
            subscribe('voice_speaking', (data) => {
                const { user_id: speakUserId, speaking } = data;
                setSpeakingUsers((prev) => {
                    const next = new Map(prev);
                    next.set(speakUserId, speaking);
                    return next;
                });
            }),
            subscribe('screenshare_start', () => fetchParticipants()),
            subscribe('screenshare_stop', () => fetchParticipants()),
            subscribe('user_updated', () => fetchParticipants()),
        ];
        return () => unsubs.forEach((unsub) => unsub());
    }, [subscribe, fetchParticipants, onParticipantLeft, onSignal, joinStateRef, userId, connectionId]);

    /** Reset speaking state (called on voice leave). */
    const resetSpeakingUsers = useCallback(() => {
        setSpeakingUsers(new Map());
    }, []);

    return {
        participants,
        setParticipants,
        speakingUsers,
        resetSpeakingUsers,
        fetchParticipants,
        joinedElsewhere,
        setJoinedElsewhere,
    };
}
