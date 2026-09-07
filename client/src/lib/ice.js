/**
 * ICE servers for 1:1 calls across Wi-Fi, mobile, and countries.
 *
 * STUN finds a public address for a direct path.
 * TURN relays media when NATs/firewalls block that path.
 */
const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

/** Public PeerJS relays (EU + US). Used when a direct path is impossible. */
const TURN_SERVERS = [
  {
    urls: [
      "turn:eu-0.turn.peerjs.com:3478?transport=udp",
      "turn:eu-0.turn.peerjs.com:3478?transport=tcp",
      "turn:us-0.turn.peerjs.com:3478?transport=udp",
      "turn:us-0.turn.peerjs.com:3478?transport=tcp",
      "turn:0.peerjs.com:3478?transport=udp",
      "turn:0.peerjs.com:3478?transport=tcp",
    ],
    username: "peerjs",
    credential: "peerjsp",
  },
];

export function defaultIceServers() {
  return [...STUN_SERVERS, ...TURN_SERVERS];
}

export function defaultRtcConfig() {
  return {
    iceServers: defaultIceServers(),
    iceCandidatePoolSize: 10,
    iceTransportPolicy: "all",
  };
}

function normalizeIceServers(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.iceServers)) return payload.iceServers;
  return [];
}

async function fetchExtraIceServers() {
  const extra = [];
  const iceUrl = import.meta.env.VITE_ICE_URL;
  const meteredDomain = import.meta.env.VITE_METERED_DOMAIN;
  const meteredKey = import.meta.env.VITE_METERED_API_KEY;

  const urls = [];
  if (iceUrl) urls.push(iceUrl);
  if (meteredDomain && meteredKey) {
    urls.push(`https://${meteredDomain}.metered.live/api/v1/turn/credentials?apiKey=${meteredKey}`);
  }

  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        extra.push(...normalizeIceServers(await res.json()));
      } catch (err) {
        console.warn("Could not load extra ICE servers", err);
      }
    }),
  );

  return extra;
}

let cached;

/** Prefetch so the first call already has relay candidates ready. */
export function loadIceConfig() {
  if (!cached) {
    cached = (async () => {
      const extra = await fetchExtraIceServers();
      return {
        iceServers: [...defaultIceServers(), ...extra],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: "all",
      };
    })();
  }
  return cached;
}
