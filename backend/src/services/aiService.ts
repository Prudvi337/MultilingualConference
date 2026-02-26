
import OpenAI, { toFile } from 'openai';
import { config } from '../config/config';
import {
  AudioBuffer,
  TranscriptionResult,
  TranslationResult,
  TTSResult,
  LanguageCode
} from '../types';
import { pcmToWav, getAudioFormat } from './audioProcessor';

// Initialize OpenAI client
// NOTE: dangerouslyAllowBrowser is set to true because our Node.js polyfills
// for livekit-client make Node.js look like a browser to other libraries.
// This is actually running on the SERVER - the API key is NOT exposed to browsers.
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  dangerouslyAllowBrowser: true, // Safe: We're on Node.js, polyfills trigger false positive
});

/**
 * Language code mapping for Whisper
 * Whisper uses ISO 639-1 codes
 */
const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: 'English',
  hi: 'Hindi',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese'
};

/**
 * Step 1: Speech-to-Text using OpenAI Whisper
 * 
 * Converts audio buffer to text and detects the spoken language.
 * 
 * @param audioBuffer - Audio buffer with PCM samples
 * @returns Transcription result with text and detected language
 * 
 * WHISPER DETAILS:
 * - Model: whisper-1 (multilingual, trained on 680k hours of audio)
 * - Input: Audio file (we send WAV format)
 * - Output: Transcribed text + language detection
 * - Supports 99+ languages
 * - Accuracy: ~95% for clear speech in supported languages
 */
export async function transcribeAudio(
  audioBuffer: AudioBuffer
): Promise<TranscriptionResult> {
  const startTime = Date.now();

  try {
    console.log(
      `[Whisper] Transcribing audio from ${audioBuffer.participantName} ` +
      `(${getAudioFormat(audioBuffer)})`
    );

    // Convert PCM to WAV format (Whisper requirement)
    const wavBuffer = pcmToWav(
      audioBuffer.samples,
      audioBuffer.sampleRate,
      audioBuffer.channels
    );

    // Use OpenAI's toFile helper to create a proper file object
    // This avoids the stream issues with the SDK
    const audioFile = await toFile(wavBuffer, 'audio.wav', { type: 'audio/wav' });

    // Call Whisper API
    // Note: We don't specify language to enable auto-detection
    const response = await openai.audio.transcriptions.create({
      file: audioFile,
      model: config.openai.whisper.model,
      response_format: 'verbose_json', // Get language detection info
      temperature: 0.0 // Deterministic output
    });

    const detectedLanguage = (response.language || 'en') as LanguageCode;
    const text = response.text.trim();

    const duration = Date.now() - startTime;

    console.log(
      `[Whisper] ✓ Transcribed in ${duration}ms | ` +
      `Language: ${LANGUAGE_NAMES[detectedLanguage]} | ` +
      `Text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`
    );

    return {
      text,
      detectedLanguage,
      confidence: 1.0 // Whisper doesn't provide confidence scores
    };
  } catch (error: any) {
    console.error('[Whisper] ✗ Transcription error:', error.message);
    throw new Error(`Whisper transcription failed: ${error.message}`);
  }
}

/**
 * Step 2: Translation using GPT-4
 * 
 * Translates text from source language to target language.
 * Uses GPT-4 for context-aware, natural translations.
 * 
 * @param text - Text to translate
 * @param sourceLanguage - Source language code
 * @param targetLanguage - Target language code
 * @returns Translation result
 * 
 * WHY GPT-4 INSTEAD OF GOOGLE TRANSLATE?
 * - Context-aware: Understands nuance and idioms
 * - Natural output: Sounds like a native speaker
 * - Technical terms: Better handling of domain-specific language
 * - Consistency: Maintains tone and style
 * 
 * COST CONSIDERATION:
 * GPT-4 is more expensive than GPT-3.5, but provides better translations.
 * For production, consider using GPT-3.5-turbo for cost savings.
 */
export async function translateText(
  text: string,
  sourceLanguage: LanguageCode,
  targetLanguage: LanguageCode
): Promise<TranslationResult> {
  const startTime = Date.now();

  // Skip translation if source and target are the same
  if (sourceLanguage === targetLanguage) {
    console.log('[Translation] Skipping - same language');
    return {
      originalText: text,
      translatedText: text,
      sourceLanguage,
      targetLanguage
    };
  }

  try {
    console.log(
      `[Translation] Translating ${LANGUAGE_NAMES[sourceLanguage]} → ` +
      `${LANGUAGE_NAMES[targetLanguage]}: "${text.substring(0, 50)}..."`
    );

    // Construct prompt for GPT-4
    const prompt = `Translate the following text from ${LANGUAGE_NAMES[sourceLanguage]} to ${LANGUAGE_NAMES[targetLanguage]}.
Provide ONLY the translation, no explanations or additional text.

Text to translate:
${text}`;

    // Call GPT-4 API
    const response = await openai.chat.completions.create({
      model: config.openai.translation.model,
      messages: [
        {
          role: 'system',
          content: 'You are a professional translator. Provide accurate, natural translations without any additional commentary.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: config.openai.translation.temperature,
      max_tokens: 500 // Limit to prevent runaway costs
    });

    const translatedText = response.choices[0]?.message?.content?.trim() || text;

    const duration = Date.now() - startTime;

    console.log(
      `[Translation] ✓ Translated in ${duration}ms: ` +
      `"${translatedText.substring(0, 50)}${translatedText.length > 50 ? '...' : ''}"`
    );

    return {
      originalText: text,
      translatedText,
      sourceLanguage,
      targetLanguage
    };
  } catch (error: any) {
    console.error('[Translation] ✗ Translation error:', error.message);
    
    // Fallback: return original text if translation fails
    console.warn('[Translation] Falling back to original text');
    return {
      originalText: text,
      translatedText: text,
      sourceLanguage,
      targetLanguage
    };
  }
}

/**
 * Step 3: Text-to-Speech using OpenAI TTS
 * 
 * Converts translated text back to audio.
 * 
 * @param text - Text to convert to speech
 * @param targetLanguage - Language of the text
 * @returns TTS result with audio buffer
 * 
 * TTS DETAILS:
 * - Model: tts-1 (fast, good quality) or tts-1-hd (slower, higher quality)
 * - Voice: alloy (neutral) - consider language-specific voices in production
 * - Output: MP3 format (needs conversion to PCM for LiveKit)
 * - Quality: Natural-sounding, minimal robotic artifacts
 * 
 * LIMITATION:
 * OpenAI TTS currently uses English-accented voices for all languages.
 * For native accents, consider:
 * - Google Cloud TTS (better multi-language support)
 * - Azure TTS (more voice options)
 * - ElevenLabs (highest quality, more expensive)
 */
export async function textToSpeech(
  text: string,
  targetLanguage: LanguageCode
): Promise<TTSResult> {
  const startTime = Date.now();

  try {
    console.log(
      `[TTS] Converting to speech (${LANGUAGE_NAMES[targetLanguage]}): ` +
      `"${text.substring(0, 50)}..."`
    );

    // Call TTS API
    const response = await openai.audio.speech.create({
      model: config.openai.tts.model,
      voice: config.openai.tts.voice,
      input: text,
      response_format: 'mp3', // MP3 is smallest and fastest
      speed: 1.0 // Normal speed
    });

    // Convert response to Buffer
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    const duration = Date.now() - startTime;
    const sizeKB = audioBuffer.length / 1024;

    console.log(
      `[TTS] ✓ Generated speech in ${duration}ms | ` +
      `Size: ${sizeKB.toFixed(1)} KB`
    );

    return {
      audioBuffer,
      format: 'mp3',
      duration: undefined // OpenAI doesn't provide duration
    };
  } catch (error: any) {
    console.error('[TTS] ✗ Text-to-speech error:', error.message);
    throw new Error(`TTS failed: ${error.message}`);
  }
}

/**
 * Complete AI Pipeline
 * 
 * Runs the full pipeline: STT → Translation → TTS
 * 
 * @param audioBuffer - Input audio from participant
 * @param targetLanguage - Language to translate to
 * @returns Complete pipeline result with timing
 */
export async function runTranslationPipeline(
  audioBuffer: AudioBuffer,
  targetLanguage: LanguageCode
) {
  const pipelineStart = Date.now();

  console.log(
    `\n[AI Pipeline] Starting for ${audioBuffer.participantName} → ` +
    `${LANGUAGE_NAMES[targetLanguage]}`
  );

  try {
    // Step 1: Speech-to-Text
    const transcription = await transcribeAudio(audioBuffer);

    // Skip if no text detected
    if (!transcription.text || transcription.text.length < 3) {
      console.log('[AI Pipeline] ✗ No meaningful text detected, skipping');
      return {
        success: false,
        error: 'No text detected',
        processingTimeMs: Date.now() - pipelineStart
      };
    }

    // Step 2: Translation
    const translation = await translateText(
      transcription.text,
      transcription.detectedLanguage,
      targetLanguage
    );

    // Step 3: Text-to-Speech
    const tts = await textToSpeech(translation.translatedText, targetLanguage);

    const totalTime = Date.now() - pipelineStart;

    console.log(
      `[AI Pipeline] ✓ Complete in ${totalTime}ms\n` +
      `  Original (${LANGUAGE_NAMES[transcription.detectedLanguage]}): "${transcription.text}"\n` +
      `  Translated (${LANGUAGE_NAMES[targetLanguage]}): "${translation.translatedText}"`
    );

    return {
      success: true,
      transcription,
      translation,
      tts,
      processingTimeMs: totalTime
    };
  } catch (error: any) {
    console.error('[AI Pipeline] ✗ Pipeline failed:', error.message);
    return {
      success: false,
      error: error.message,
      processingTimeMs: Date.now() - pipelineStart
    };
  }
}

