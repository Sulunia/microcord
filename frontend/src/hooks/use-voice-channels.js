import { useState, useCallback, useEffect } from 'preact/hooks';
import { API_BASE } from '../constants.js';
import { authedFetch } from './use-user.js';
import { useRealtime } from './realtime.jsx';

export function useVoiceChannels() {
    const [voiceChannels, setVoiceChannels] = useState([]);
    const { subscribe } = useRealtime();

    const fetchVoiceChannels = useCallback(async () => {
        try {
            const res = await authedFetch(`${API_BASE}/voice-channels`);
            if (res.ok) setVoiceChannels(await res.json());
        } catch {}
    }, []);

    useEffect(() => { fetchVoiceChannels(); }, [fetchVoiceChannels]);

    useEffect(() => {
        const unsubs = [
            subscribe('voice_channel_created', (data) => {
                setVoiceChannels((prev) => [...prev, { ...data, participant_count: 0 }]);
            }),
            subscribe('voice_channel_deleted', (data) => {
                setVoiceChannels((prev) => prev.filter((vc) => vc.id !== data.id));
            }),
            subscribe('voice_participant_joined', (data) => {
                if (data.channel_id) {
                    setVoiceChannels((prev) =>
                        prev.map((vc) =>
                            vc.id === data.channel_id
                                ? { ...vc, participant_count: (vc.participant_count || 0) + 1 }
                                : vc
                        )
                    );
                }
            }),
            subscribe('voice_participant_left', (data) => {
                if (data.channel_id) {
                    setVoiceChannels((prev) =>
                        prev.map((vc) =>
                            vc.id === data.channel_id
                                ? { ...vc, participant_count: Math.max(0, (vc.participant_count || 0) - 1) }
                                : vc
                        )
                    );
                }
            }),
            subscribe('presence_init', (data) => {
                if (data.voice_channels) {
                    setVoiceChannels(data.voice_channels);
                }
            }),
        ];
        return () => unsubs.forEach((u) => u());
    }, [subscribe]);

    const createVoiceChannel = useCallback(async (name) => {
        const res = await authedFetch(`${API_BASE}/voice-channels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to create voice channel');
        }
        return res.json();
    }, []);

    const deleteVoiceChannel = useCallback(async (channelId) => {
        const res = await authedFetch(`${API_BASE}/voice-channels/${channelId}`, {
            method: 'DELETE',
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to delete voice channel');
        }
    }, []);

    return {
        voiceChannels,
        fetchVoiceChannels,
        createVoiceChannel,
        deleteVoiceChannel,
    };
}
