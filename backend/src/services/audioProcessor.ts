import { Readable } from 'stream';
import { config } from '../config/config';
import { AudioBuffer } from '../types';

/**
 * Audio buffer manager for a single participant
 * Accumulates audio frames until ready for processing
 */
export class ParticipantAudioBuffer {
  private samples: Int16Array[] = [];
  private totalSamples = 0;
  private readonly sampleRate: number;
  private readonly channels: number;
  private readonly targetSamples: number;

  constructor(
    public readonly participantId: string,
    public readonly participantName: string,
    public readonly roomName: string,
    sampleRate: number = config.audio.sampleRate,
    channels: number = config.audio.channels
  ) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    
    // Calculate target samples for buffer duration
    // Formula: sampleRate * (duration_ms / 1000)
    // Example: 48000 * (1500 / 1000) = 72000 samples = 1.5 seconds
    this.targetSamples = Math.floor(
      (sampleRate * config.audio.bufferDurationMs) / 1000
    );

    console.log(
      `[AudioBuffer] Created buffer for ${participantName} ` +
      `(target: ${this.targetSamples} samples = ${config.audio.bufferDurationMs}ms)`
    );
  }

  /**
   * Add audio frame to buffer
   * 
   * @param samples - Int16Array of PCM samples
   */
  addFrame(samples: Int16Array): void {
    this.samples.push(samples);
    this.totalSamples += samples.length;
  }

  /**
   * Check if buffer has enough data for processing
   */
  isReady(): boolean {
    return this.totalSamples >= this.targetSamples;
  }

  /**
   * Get current buffer size in milliseconds
   */
  getDurationMs(): number {
    return (this.totalSamples / this.sampleRate) * 1000;
  }

  /**
   * Flush buffer and return accumulated audio
   * Resets buffer after extraction
   * 
   * @returns AudioBuffer ready for AI processing
   */
  flush(): AudioBuffer | null {
    if (this.totalSamples === 0) {
      return null;
    }

    // Concatenate all sample arrays into one
    const combined = new Int16Array(this.totalSamples);
    let offset = 0;
    for (const chunk of this.samples) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Check if audio is silent (avoid processing silence)
    const avgEnergy = calculateAudioEnergy(combined);
    
    const audioBuffer: AudioBuffer = {
      participantId: this.participantId,
      participantName: this.participantName,
      roomName: this.roomName,
      samples: combined,
      sampleRate: this.sampleRate,
      channels: this.channels,
      timestamp: Date.now()
    };

    // Reset buffer
    this.samples = [];
    this.totalSamples = 0;

    // Check if audio is too quiet (likely silence or noise)
    if (avgEnergy < config.audio.silenceThreshold) {
      console.log(
        `[AudioBuffer] Skipping silent audio from ${this.participantName} ` +
        `(energy: ${avgEnergy.toFixed(4)})`
      );
      return null;
    }

    console.log(
      `[AudioBuffer] Flushed ${combined.length} samples ` +
      `(${this.getDurationMs().toFixed(0)}ms) from ${this.participantName}`
    );

    return audioBuffer;
  }

  /**
   * Clear all buffered data
   */
  clear(): void {
    this.samples = [];
    this.totalSamples = 0;
  }
}

/**
 * Calculate average audio energy (RMS)
 * Used for silence detection
 * 
 * Formula: RMS = sqrt(sum(sample^2) / count) / max_value
 * 
 * @param samples - PCM samples
 * @returns Normalized energy (0.0 to 1.0)
 */
function calculateAudioEnergy(samples: Int16Array): number {
  if (samples.length === 0) return 0;

  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const normalized = samples[i] / 32768.0; // Normalize to [-1, 1]
    sum += normalized * normalized;
  }

  return Math.sqrt(sum / samples.length);
}

/**
 * Convert PCM samples to WAV file format
 * 
 * WAV file structure:
 * - RIFF header (identifies file as WAV)
 * - Format chunk (sample rate, bit depth, channels)
 * - Data chunk (actual PCM samples)
 * 
 * @param samples - PCM samples (Int16Array)
 * @param sampleRate - Sample rate (e.g., 48000 Hz)
 * @param channels - Number of channels (1 = mono, 2 = stereo)
 * @returns Buffer containing complete WAV file
 */
export function pcmToWav(
  samples: Int16Array,
  sampleRate: number = config.audio.sampleRate,
  channels: number = config.audio.channels
): Buffer {
  const bitDepth = 16;
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const dataSize = samples.length * 2; // 2 bytes per sample (16-bit)

  // Create WAV file buffer
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // Format chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Chunk size
  buffer.writeUInt16LE(1, 20);  // Audio format (1 = PCM)
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);

  // Data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Write PCM samples
  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }

  return buffer;
}

/**
 * Convert WAV buffer to Readable stream
 * Required by OpenAI SDK for audio upload
 * 
 * @param wavBuffer - WAV file buffer
 * @returns Readable stream
 */
export function wavBufferToStream(wavBuffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(wavBuffer);
  stream.push(null); // Signal end of stream
  return stream;
}

/**
 * Get audio format information (for debugging)
 * 
 * @param audioBuffer - Audio buffer to inspect
 * @returns Human-readable format string
 */
export function getAudioFormat(audioBuffer: AudioBuffer): string {
  const durationMs = (audioBuffer.samples.length / audioBuffer.sampleRate) * 1000;
  const sizeKB = (audioBuffer.samples.length * 2) / 1024; // 2 bytes per sample

  return (
    `Format: ${audioBuffer.sampleRate}Hz, ` +
    `${audioBuffer.channels}ch, 16-bit PCM | ` +
    `Duration: ${durationMs.toFixed(0)}ms | ` +
    `Size: ${sizeKB.toFixed(1)} KB`
  );
}

