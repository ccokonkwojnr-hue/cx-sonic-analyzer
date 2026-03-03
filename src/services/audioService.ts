/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export class AudioService {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyzer: AnalyserNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private gainNode: GainNode | null = null;
  private maxLevel: number = 0;
  private levelInterval: number | null = null;

  async initialize(): Promise<AnalyserNode> {
    if (this.analyzer) return this.analyzer;

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new AudioContext();
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    
    this.gainNode = this.audioContext.createGain();
    this.analyzer = this.audioContext.createAnalyser();
    this.analyzer.fftSize = 2048;

    this.source.connect(this.gainNode);
    this.gainNode.connect(this.analyzer);

    return this.analyzer;
  }

  setSensitivity(value: number) {
    if (this.gainNode) {
      this.gainNode.gain.value = value;
    }
  }

  startRecording() {
    if (!this.stream || !this.analyzer) throw new Error("Audio not initialized");
    
    this.chunks = [];
    this.maxLevel = 0;
    
    const dataArray = new Uint8Array(this.analyzer.frequencyBinCount);
    this.levelInterval = window.setInterval(() => {
      if (this.analyzer) {
        this.analyzer.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const avg = sum / dataArray.length;
        if (avg > this.maxLevel) this.maxLevel = avg;
      }
    }, 100);

    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start();
  }

  async stopRecording(): Promise<Blob> {
    if (this.levelInterval) {
      clearInterval(this.levelInterval);
      this.levelInterval = null;
    }

    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error("Recorder not started"));
        return;
      }

      this.mediaRecorder.onstop = () => {
        if (this.maxLevel < 0.5) { // Very low threshold for silence
          reject(new Error("No audio detected. Please check your microphone and sensitivity."));
          return;
        }
        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        resolve(blob);
      };
      this.mediaRecorder.stop();
    });
  }

  cleanup() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}

export const audioService = new AudioService();
