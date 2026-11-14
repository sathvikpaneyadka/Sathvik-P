import type { SupportedLang } from '../core/i18n';

let activeAudioEl: HTMLAudioElement | null = null;

export async function speakMultilingual(text: string, lang: SupportedLang): Promise<'gemini_tts' | 'browser_tts'> {
  stopActiveSpeech();

  try {
    const res = await fetch('/api/ai/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: lang }),
    });
    if (res.ok) {
      const data = (await res.json()) as { audioBase64?: string; mimeType?: string };
      if (data.audioBase64) {
        const src = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
        activeAudioEl = new Audio(src);
        await activeAudioEl.play().catch(() => {
          // Autoplay may be muted in headless mode; speech still succeeded server-side
        });
        return 'gemini_tts';
      }
    }
  } catch {
    // Fall back to Web Speech API
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang === 'hi' ? 'hi-IN' : lang === 'es' ? 'es-ES' : lang === 'ta' ? 'ta-IN' : 'en-US';
    window.speechSynthesis.speak(utter);
  }
  return 'browser_tts';
}

export function stopActiveSpeech(): void {
  if (activeAudioEl) {
    activeAudioEl.pause();
    activeAudioEl = null;
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export function startBrowserDictation(
  lang: SupportedLang,
  onInterim: (text: string) => void,
  onFinal: (text: string) => void,
  onError: (msg: string) => void
): (() => void) | null {
  const Ctor =
    (window as Window & { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition })
      .SpeechRecognition ||
    (window as Window & { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;

  if (!Ctor) {
    onError('Browser speech recognition unavailable; record audio clip to transcribe via Gemini.');
    return null;
  }

  const rec = new Ctor();
  rec.lang = lang === 'hi' ? 'hi-IN' : lang === 'es' ? 'es-ES' : lang === 'ta' ? 'ta-IN' : 'en-US';
  rec.interimResults = true;
  rec.continuous = false;

  rec.onresult = (event) => {
    let finalChunk = '';
    let interimChunk = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0]?.transcript ?? '';
      if (event.results[i].isFinal) finalChunk += text;
      else interimChunk += text;
    }
    if (interimChunk) onInterim(interimChunk);
    if (finalChunk) onFinal(finalChunk);
  };

  rec.onerror = (event) => {
    onError(`Mic dictation notice: ${event.error}`);
  };

  rec.start();
  return () => {
    try {
      rec.stop();
    } catch {
      // Ignore already stopped
    }
  };
}

export class GeminiLiveVoiceClient {
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private nextPlayTime = 0;

  async connect(
    mode: 'live' | 'translate',
    lang: SupportedLang,
    handlers: {
      onStatus: (msg: string) => void;
      onTranscript: (speaker: 'user' | 'assistant', text: string) => void;
      onClose: () => void;
    }
  ): Promise<void> {
    this.disconnect();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const path = mode === 'translate' ? '/ws/translate' : '/ws/live';
    const url = `${proto}//${window.location.host}${path}?lang=${encodeURIComponent(lang)}`;

    this.ws = new WebSocket(url);
    this.audioCtx = new AudioContext({ sampleRate: 24000 });
    this.nextPlayTime = this.audioCtx.currentTime;

    this.ws.onopen = () => {
      handlers.onStatus(mode === 'translate' ? 'Live translator connecting...' : 'Live voice assistant connecting...');
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as {
          type: string;
          data?: string;
          text?: string;
          message?: string;
        };
        if (msg.type === 'connected') {
          handlers.onStatus('Connected. Speak or send a clinical prompt.');
          void this.startMicrophoneStream();
        } else if (msg.type === 'audio' && msg.data) {
          this.playPcm24k(msg.data);
        } else if (msg.type === 'input_transcript' && msg.text) {
          handlers.onTranscript('user', msg.text);
        } else if ((msg.type === 'output_transcript' || msg.type === 'text') && msg.text) {
          handlers.onTranscript('assistant', msg.text);
        } else if (msg.type === 'error') {
          handlers.onStatus(msg.message || 'Live voice error');
        }
      } catch {
        // Ignore parse error
      }
    };

    this.ws.onclose = () => {
      this.stopMic();
      handlers.onClose();
    };
  }

  sendText(text: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'text', text }));
    }
  }

  private async startMicrophoneStream(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const micCtx = new AudioContext({ sampleRate: 16000 });
      const source = micCtx.createMediaStreamSource(this.mediaStream);
      this.processor = micCtx.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (event) => {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        const float32 = event.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const bytes = new Uint8Array(int16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        this.ws.send(
          JSON.stringify({
            type: 'audio',
            mimeType: 'audio/pcm;rate=16000',
            data: btoa(binary),
          })
        );
      };

      source.connect(this.processor);
      this.processor.connect(micCtx.destination);
    } catch {
      // Microphone permission may be unavailable in headless browser; text turn remains usable
    }
  }

  private playPcm24k(base64Data: string): void {
    if (!this.audioCtx) return;
    const raw = atob(base64Data);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const buffer = this.audioCtx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    const src = this.audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.audioCtx.destination);
    const startAt = Math.max(this.audioCtx.currentTime, this.nextPlayTime);
    src.start(startAt);
    this.nextPlayTime = startAt + buffer.duration;
  }

  private stopMic(): void {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) track.stop();
      this.mediaStream = null;
    }
  }

  disconnect(): void {
    this.stopMic();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
