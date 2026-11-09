/**
 * Kiroku Note Desktop — Link Store (Slice 38)
 * Reactive central store tracking active video sessions, playback state, and cue lists.
 * Exposes live status to Settings Link section (Slice 24) and Vocab Watch (Slice 39).
 */

export class LinkStore {
  constructor(linkClient) {
    this.client = linkClient;
    this.status = linkClient ? linkClient.status : 'disconnected';
    this.sessions = new Map(); // tabId -> session object
    this.activeTabId = null;
    this.activeSession = null;
    this.videoState = {
      t: 0,
      paused: true,
      rate: 1,
      vol: 1,
      muted: false
    };
    this.cues = [];
    this.cueHash = null;
    this.activeCueIndex = null;
    this.activeCue = null;
    this.peerCounts = { ext: 0, desk: 0 };
    this.subStatus = null;
    this.pendingCueChunks = new Map(); // hash -> { parts, received: Map(part -> cues) }
    this.listeners = new Map(); // event -> Set<function>

    if (this.client) {
      this._wireClient();
    }
  }

  _wireClient() {
    this.client.on('status', (newStatus) => {
      this.status = newStatus;
      if (newStatus === 'disconnected') {
        this.videoState.paused = true;
      }
      this.emit('status', this.status);
    });

    this.client.on('video.attach', (payload) => {
      if (!payload || typeof payload !== 'object') return;
      const tabId = payload.tab || 0;
      const session = {
        tab: tabId,
        site: payload.site || 'unknown',
        title: payload.title || 'Untitled Video',
        duration: payload.duration || 0,
        drm: Boolean(payload.drm),
        lastSeen: Date.now()
      };
      this.sessions.set(tabId, session);
      if (!this.activeTabId || this.activeTabId === tabId) {
        this.activeTabId = tabId;
        this.activeSession = session;
      }
      this.emit('session', this.activeSession, session);
      this.emit('change');
    });

    this.client.on('video.detach', (payload) => {
      const tabId = payload?.tab || 0;
      this.sessions.delete(tabId);
      if (this.activeTabId === tabId || this.sessions.size === 0) {
        if (this.sessions.size > 0) {
          const nextTab = this.sessions.keys().next().value;
          this.activeTabId = nextTab;
          this.activeSession = this.sessions.get(nextTab);
        } else {
          this.activeTabId = null;
          this.activeSession = null;
          this.cues = [];
          this.cueHash = null;
          this.activeCue = null;
          this.activeCueIndex = null;
          for (const group of this.pendingCueChunks.values()) {
            if (group?.timer) clearTimeout(group.timer);
          }
          this.pendingCueChunks.clear();
        }
      }
      this.emit('video:detach', payload);
      this.emit('session', this.activeSession, null);
      this.emit('change');
    });

    this.client.on('peer.status', (payload) => {
      if (!payload || typeof payload !== 'object') return;
      this.peerCounts = {
        ext: typeof payload.ext === 'number' ? payload.ext : this.peerCounts.ext,
        desk: typeof payload.desk === 'number' ? payload.desk : this.peerCounts.desk
      };
      this.emit('peer:status', this.peerCounts);
      this.emit('change');
    });

    this.client.on('sub.status', (payload) => {
      if (!payload || typeof payload !== 'object') return;
      this.subStatus = payload;
      this.emit('sub:status', payload);
      this.emit('change');
    });

    this.client.on('ack', (payload) => {
      this.emit('ack', payload);
    });

    this.client.on('video.state', (payload) => {
      if (!payload || typeof payload !== 'object') return;
      this.videoState = {
        t: typeof payload.t === 'number' ? payload.t : this.videoState.t,
        paused: typeof payload.paused === 'boolean' ? payload.paused : this.videoState.paused,
        rate: typeof payload.rate === 'number' ? payload.rate : this.videoState.rate,
        vol: typeof payload.vol === 'number' ? payload.vol : this.videoState.vol,
        muted: typeof payload.muted === 'boolean' ? payload.muted : this.videoState.muted
      };
      if (this.cues.length > 0 && this.activeCueIndex === null) {
        this._updateActiveCueFromTime(this.videoState.t);
      }
      this.emit('video:state', this.videoState);
      this.emit('change');
    });

    this.client.on('cue.list', (payload) => {
      if (!payload || typeof payload !== 'object') return;
      const parts = payload.parts || 1;
      const part = payload.part || 1;
      const hash = payload.hash || null;

      if (parts > 1 && hash) {
        // Prune oldest pending chunk groups if too many accumulate
        if (this.pendingCueChunks.size > 5 && !this.pendingCueChunks.has(hash)) {
          const oldest = this.pendingCueChunks.keys().next().value;
          const oldGroup = this.pendingCueChunks.get(oldest);
          if (oldGroup?.timer) clearTimeout(oldGroup.timer);
          this.pendingCueChunks.delete(oldest);
        }

        let chunkGroup = this.pendingCueChunks.get(hash);
        if (!chunkGroup || chunkGroup.parts !== parts) {
          if (chunkGroup?.timer) clearTimeout(chunkGroup.timer);
          chunkGroup = { parts, received: new Map(), timer: null };
          this.pendingCueChunks.set(hash, chunkGroup);
        }
        chunkGroup.received.set(part, Array.isArray(payload.cues) ? payload.cues : []);

        if (chunkGroup.received.size === parts) {
          if (chunkGroup.timer) clearTimeout(chunkGroup.timer);
          let assembled = [];
          for (let p = 1; p <= parts; p++) {
            const piece = chunkGroup.received.get(p) || [];
            assembled = assembled.concat(piece);
          }
          this.pendingCueChunks.delete(hash);
          this.cues = assembled;
          this.cueHash = hash;
          if (typeof this.videoState?.t === 'number') {
            this._updateActiveCueFromTime(this.videoState.t);
          }
          this.emit('cues', this.cues, this.cueHash);
          this.emit('change');
        } else if (!chunkGroup.timer && typeof setTimeout === 'function') {
          // If not all parts arrived within 2500ms, request retry for hash
          chunkGroup.timer = setTimeout(() => {
            if (this.pendingCueChunks.has(hash)) {
              if (this.client && typeof this.client.sendCommand === 'function') {
                try {
                  this.client.sendCommand('cue.request', { hash });
                } catch (_) {}
              }
            }
          }, 2500);
        }
        return;
      }

      this.cues = Array.isArray(payload.cues) ? payload.cues : [];
      this.cueHash = hash;
      if (typeof this.videoState?.t === 'number') {
        this._updateActiveCueFromTime(this.videoState.t);
      }
      this.emit('cues', this.cues, this.cueHash);
      this.emit('change');
    });

    this.client.on('cue.active', (payload) => {
      const idx = payload?.i !== undefined ? payload.i : null;
      this.activeCueIndex = idx;
      this.activeCue = idx !== null ? (this.cues.find(c => c.i === idx) || null) : null;
      this.emit('cue:active', this.activeCue, idx);
      this.emit('change');
    });

    this.client.on('clip.result', (payload) => {
      this.emit('clip:result', payload);
    });
  }

  _updateActiveCueFromTime(currentTime) {
    if (!this.cues || this.cues.length === 0) {
      this.activeCue = null;
      this.activeCueIndex = null;
      return;
    }
    const match = this.cues.find(c => currentTime >= c.s && currentTime <= c.e);
    if (match) {
      if (this.activeCueIndex !== match.i) {
        this.activeCueIndex = match.i;
        this.activeCue = match;
        this.emit('cue:active', this.activeCue, this.activeCueIndex);
      }
    } else {
      if (this.activeCueIndex !== null) {
        this.activeCueIndex = null;
        this.activeCue = null;
        this.emit('cue:active', null, null);
      }
    }
  }

  on(event, fn) {
    if (typeof fn !== 'function') return this;
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(fn);
    return this;
  }

  off(event, fn) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(fn);
    }
    return this;
  }

  emit(event, ...args) {
    if (this.listeners.has(event)) {
      for (const fn of this.listeners.get(event)) {
        try {
          fn(...args);
        } catch (err) {
          console.error(`[LinkStore] Error in listener for "${event}":`, err);
        }
      }
    }
  }

  play() {
    return this.client ? this.client.sendCommand('cmd.play', {}) : null;
  }

  pause() {
    return this.client ? this.client.sendCommand('cmd.pause', {}) : null;
  }

  toggle() {
    return this.client ? this.client.sendCommand('cmd.toggle', {}) : null;
  }

  seek(t, delta) {
    if (!this.client) return null;
    const payload = {};
    if (typeof t === 'number') payload.t = t;
    if (typeof delta === 'number') payload.delta = delta;
    return this.client.sendCommand('cmd.seek', payload);
  }

  jumpCue(options = {}) {
    return this.client ? this.client.sendCommand('cmd.cue', options) : null;
  }

  loop(s, e, count = 1) {
    return this.client ? this.client.sendCommand('cmd.loop', { s, e, count }) : null;
  }

  setRate(v) {
    return this.client ? this.client.sendCommand('cmd.rate', { v }) : null;
  }

  setOffset(ms) {
    return this.client ? this.client.sendCommand('cmd.offset', { ms }) : null;
  }

  requestClip(reqId, s, e, want = ['image', 'audio']) {
    return this.client ? this.client.sendCommand('cmd.clip', { reqId, s, e, want }) : null;
  }

  nextEpisode() {
    return this.client ? this.client.sendCommand('cmd.next_episode', {}) : null;
  }

  getCue(index) {
    if (typeof index !== 'number') return null;
    return this.cues.find(c => c.i === index) || null;
  }

  getStatusSummary() {
    return {
      connected: this.status === 'connected',
      status: this.status,
      peerCounts: this.peerCounts,
      subStatus: this.subStatus,
      sessionsCount: this.sessions.size,
      activeSession: this.activeSession,
      videoState: this.videoState,
      activeCue: this.activeCue,
      activeCueIndex: this.activeCueIndex,
      cueCount: this.cues.length,
      cueHash: this.cueHash
    };
  }
}
