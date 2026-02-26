/**
 * Configuration Management
 * 
 * Centralizes all environment variables and configuration settings.
 * Uses dotenv to load from .env file in development.
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Validates that required environment variables are present
 */
function validateConfig() {
  const required = [
    'OPENAI_API_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please copy .env.example to .env and fill in the values.'
    );
  }
}

// Validate on module load
validateConfig();

/**
 * Application Configuration
 */
export const config = {
  // Server settings
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    isDevelopment: process.env.NODE_ENV !== 'production'
  },

  // OpenAI settings
  openai: {
    apiKey: process.env.OPENAI_API_KEY!,
    // Model configurations
    whisper: {
      model: 'whisper-1' as const
    },
    translation: {
      model: 'gpt-4' as const,
      temperature: 0.3 // Lower = more deterministic translations
    },
    tts: {
      model: 'tts-1' as const, // Use tts-1-hd for better quality (slower)
      voice: 'alloy' as const  // Options: alloy, echo, fable, onyx, nova, shimmer
    }
  },

  // Audio processing settings
  audio: {
    // Buffer size in milliseconds before processing
    // 1500ms = 1.5 seconds (good balance between latency and accuracy)
    bufferDurationMs: 1500,
    
    // LiveKit audio format
    sampleRate: 48000,  // 48kHz (WebRTC standard)
    channels: 1,        // Mono
    bitDepth: 16,       // 16-bit PCM
    
    // Minimum audio energy threshold (to avoid processing silence)
    silenceThreshold: 0.01
  },

  // Supported languages for translation
  languages: {
    supported: [
      { code: 'en', name: 'English' },
      { code: 'hi', name: 'Hindi' },
      { code: 'es', name: 'Spanish' },
      { code: 'fr', name: 'French' },
      { code: 'de', name: 'German' },
      { code: 'ja', name: 'Japanese' },
      { code: 'ko', name: 'Korean' },
      { code: 'zh', name: 'Chinese' }
    ]
  }
};

export default config;

