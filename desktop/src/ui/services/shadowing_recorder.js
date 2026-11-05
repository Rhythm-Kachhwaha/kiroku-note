/**
 * Kiroku Note Desktop — Web Audio Shadowing Recorder
 * Records user microphone input for shadowing and speech comparison against native audio cues.
 */

export class ShadowingRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.recordedBlob = null;
    this.recordedUrl = null;
    this.isRecording = false;
    this.stream = null;
  }

  async startRecording() {
    if (this.isRecording) return;
    this.audioChunks = [];

    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia not supported in this environment');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(this.stream);

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.audioChunks.push(e.data);
      }
    };

    this.mediaRecorder.start();
    this.isRecording = true;
  }

  async stopRecording() {
    if (!this.isRecording || !this.mediaRecorder) {
      return { blob: this.recordedBlob, url: this.recordedUrl };
    }

    return new Promise((resolve) => {
      this.mediaRecorder.onstop = () => {
        this.recordedBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        if (this.recordedUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
          URL.revokeObjectURL(this.recordedUrl);
        }
        this.recordedUrl = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(this.recordedBlob) : null;
        this.isRecording = false;

        if (this.stream) {
          this.stream.getTracks().forEach((track) => track.stop());
          this.stream = null;
        }

        resolve({ blob: this.recordedBlob, url: this.recordedUrl });
      };

      this.mediaRecorder.stop();
    });
  }

  playRecording() {
    if (!this.recordedUrl || typeof Audio === 'undefined') return null;
    const audio = new Audio(this.recordedUrl);
    audio.play().catch((err) => {
      console.warn('[ShadowingRecorder] Playback failed:', err);
    });
    return audio;
  }

  dispose() {
    if (this.isRecording && this.mediaRecorder) {
      try { this.mediaRecorder.stop(); } catch (_) {}
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.recordedUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(this.recordedUrl);
    }
    this.recordedBlob = null;
    this.recordedUrl = null;
    this.audioChunks = [];
    this.isRecording = false;
  }
}
