/**
 * Factory that creates a WebRTC peer-connection map with lifecycle helpers.
 *
 * The returned object is a plain mutable structure — store it in a ref and
 * call its methods from callbacks or effects.  It is NOT tied to any
 * rendering cycle.
 *
 * @param {() => { iceServers: RTCIceServer[], sendSignal: (targetId: string, signal: object) => void }} getConfig
 *   Called on every peer operation to read the latest ICE servers and
 *   signal-sender.  Because this is a thunk, callers can pass a ref-based
 *   getter that always returns current values.
 * @returns {{ peers: Map<string, RTCPeerConnection>, closePeer, closeAllPeers, getPeer, createPeer, sendOffer, applySignal }}
 */
export function createPeerMap(getConfig) {
    const peers = new Map();

    /**
     * Close and remove a single peer connection.
     * @param {string} targetId
     */
    function closePeer(targetId) {
        const peerConnection = peers.get(targetId);
        if (peerConnection) {
            peerConnection.close();
            peers.delete(targetId);
        }
    }

    /** Close and remove every peer connection in the map. */
    function closeAllPeers() {
        peers.forEach((peerConnection) => peerConnection.close());
        peers.clear();
    }

    /**
     * @param {string} targetId
     * @returns {RTCPeerConnection | undefined}
     */
    function getPeer(targetId) {
        return peers.get(targetId);
    }

    /**
     * Create a new RTCPeerConnection for `targetId`, replacing any
     * existing one.  ICE candidates are forwarded automatically via
     * the `sendSignal` from `getConfig()`.
     *
     * @param {string} targetId
     * @param {object}  [options]
     * @param {(pc: RTCPeerConnection, targetId: string) => void} [options.onCreated]
     *   Called after the PC is created but before it is stored — use this
     *   to add local tracks, set `ontrack`, etc.
     * @returns {RTCPeerConnection}
     */
    function createPeer(targetId, { onCreated } = {}) {
        closePeer(targetId);
        const { iceServers, sendSignal } = getConfig();
        const peerConnection = new RTCPeerConnection({ iceServers });

        peerConnection.onicecandidate = (event) => {
            if (!event.candidate) return;
            sendSignal(targetId, { type: 'ice-candidate', candidate: event.candidate });
        };

        if (onCreated) onCreated(peerConnection, targetId);

        peers.set(targetId, peerConnection);
        return peerConnection;
    }

    /**
     * Create a peer, produce an SDP offer, and send it.
     *
     * @param {string} targetId
     * @param {object}  [options]
     * @param {(pc: RTCPeerConnection, targetId: string) => void} [options.onCreated]
     * @param {(sdp: string) => string} [options.mungeSdp]
     *   Optional transform applied to the offer SDP before sending
     *   (e.g. Opus bitrate munging).
     */
    async function sendOffer(targetId, { onCreated, mungeSdp } = {}) {
        const peerConnection = createPeer(targetId, { onCreated });
        const offer = await peerConnection.createOffer();
        const sdp = mungeSdp ? mungeSdp(offer.sdp) : offer.sdp;
        await peerConnection.setLocalDescription({ type: offer.type, sdp });
        const { sendSignal } = getConfig();
        sendSignal(targetId, { type: 'offer', sdp });
    }

    /**
     * Route an incoming signaling message (offer / answer / ICE candidate)
     * to the correct handler.  For `offer` messages a new peer is created
     * automatically; for `answer` and `ice-candidate` the existing peer is
     * looked up by `fromId`.
     *
     * @param {string} fromId  — remote peer user ID
     * @param {{ type: string, sdp?: string, candidate?: RTCIceCandidateInit }} signal
     * @param {object}  [options]
     * @param {(pc: RTCPeerConnection, targetId: string) => void} [options.onCreated]
     * @param {(sdp: string) => string} [options.mungeSdp]
     */
    async function applySignal(fromId, signal, { onCreated, mungeSdp } = {}) {
        const { sendSignal } = getConfig();

        switch (signal.type) {
            case 'offer': {
                const peerConnection = createPeer(fromId, { onCreated });
                await peerConnection.setRemoteDescription(
                    new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }),
                );
                const answer = await peerConnection.createAnswer();
                const sdp = mungeSdp ? mungeSdp(answer.sdp) : answer.sdp;
                await peerConnection.setLocalDescription({ type: answer.type, sdp });
                sendSignal(fromId, { type: 'answer', sdp });
                break;
            }
            case 'answer': {
                const peerConnection = peers.get(fromId);
                if (peerConnection) {
                    await peerConnection.setRemoteDescription(
                        new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }),
                    );
                }
                break;
            }
            case 'ice-candidate': {
                const peerConnection = peers.get(fromId);
                if (peerConnection && signal.candidate) {
                    await peerConnection
                        .addIceCandidate(new RTCIceCandidate(signal.candidate))
                        .catch(() => {});
                }
                break;
            }
        }
    }

    return { peers, closePeer, closeAllPeers, getPeer, createPeer, sendOffer, applySignal };
}
