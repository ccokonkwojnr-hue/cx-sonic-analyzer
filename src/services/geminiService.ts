/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from "@google/genai";

export interface DelayTap {
  timeMs: number;
  amplitude: number; // 0-1
  pan: number; // -1 to 1
}

export interface FilterData {
  lowCut: number; // Hz
  highCut: number; // Hz
}

export interface DelayInfo {
  type: string;
  time: string;
  feedback: string;
  level: string;
  pattern?: DelayTap[];
  filters?: FilterData;
}

export interface AudioAnalysis {
  bpm?: number;
  reverbType: string;
  decayTime: string;
  predelay: string;
  reverbFilters?: FilterData;
  reverbVisualData: {
    density: number;
    diffusion: number;
    brightness: number;
    size: number;
    earlyReflections: number;
    tailLevel: number;
    damping: number;
  };
  saturation: {
    types: string[];
    intensity: string;
    description: string;
  };
  eqProfile: {
    lows: number;
    lowMids: number;
    highMids: number;
    highs: number;
    overall: string;
    // Tonal character profiles (0-100 for each band)
    reverbProfile: { lows: number; lowMids: number; highMids: number; highs: number };
    delayProfile: { lows: number; lowMids: number; highMids: number; highs: number };
    saturationProfile: { lows: number; lowMids: number; highMids: number; highs: number };
  };
  delays: {
    leadVocal: DelayInfo[];
    backgroundVocals: DelayInfo[];
  };
  vocalAnalysis: {
    lead: {
      presence: string;
      processing: string;
    };
    background: {
      stacks: number;
      mixType: string; // e.g., Unison, Harmonies, Gang, Whispers
      spread: string; // e.g., Wide, Centered
      processing: string;
      tonalBalance: string;
      arrangementDetails: string; // New: Details about the BV arrangement
    };
  };
  matchEqSettings: string;
  confidence: number;
}

export async function analyzeAudio(audioBlob: Blob, userBpm?: number, startTime?: number): Promise<AudioAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not found");

  const genAI = new GoogleGenAI({ apiKey });
  
  const reader = new FileReader();
  const base64Promise = new Promise<string>((resolve) => {
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.readAsDataURL(audioBlob);
  });

  const base64Data = await base64Promise;

  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: audioBlob.type,
                  data: base64Data,
                },
              },
              {
                text: `Analyze the audio snippet provided with EXTREME precision, focusing EXCLUSIVELY on VOCAL production. 
                
                CRITICAL REQUIREMENT: This tool is designed for VOCAL analysis. If you do not detect a human vocal performance (lead or background) in this audio, you MUST return a JSON object with "confidence": 0 and a "matchEqSettings" value explaining that no vocals were detected.
                
                BPM DETECTION: 
                ${userBpm ? `The user specified a BPM of ${userBpm}. This is the AUTHORITATIVE tempo. Use it to calculate all time-based effects (delays, reverb pre-delay) in musical divisions (e.g., 1/4, 1/8D, 1/16).` : "Identify the BPM with scientific precision. Perform a micro-transient analysis and beat-grid alignment on the vocal transients and rhythmic cadence. Focus on the 100Hz-300Hz range for vocal fundamentals to derive the exact tempo. If the tempo is slightly off from a whole number (e.g., 127.9), round to the nearest whole number unless it's clearly intentional."}
                
                STEM SEPARATION SIMULATION:
                Perform the analysis as if you have isolated the vocal stem from the backing track. Analyze the 'dry' vocal characteristics and the 'wet' tonal tails (reverb and delay) as distinct layers.
                
                ${startTime ? `The analysis should focus on the section starting at ${startTime} seconds.` : ""}
                
                Focus on professional music production characteristics:
                1. Reverb: Type, Decay, Predelay, Density (0-100), Diffusion (0-100), Brightness (0-100), Size (0-100), Early Reflections (0-100), Tail Level (0-100), Damping (0-100). 
                   Include Reverb EQ filters: lowCut (Hz) and highCut (Hz).
                2. Saturation: Types (Tape, Tube, etc.), intensity, and harmonic description of the vocal grit.
                3. EQ Profile: 
                   - Main EQ: Numerical values (0-100) for Lows, Low-Mids, High-Mids, Highs.
                   - Tonal Profiles: Provide separate frequency profiles (0-100 for Lows, LowMids, HighMids, Highs) for the REVERB, DELAY, and SATURATION components specifically. This represents where these effects are most prominent in the frequency spectrum of the vocal tails.
                4. Delay Analysis: Identify multiple delays for Lead and Background vocals. 
                   - For each delay, include: 'pattern' (array of {timeMs, amplitude, pan}) and 'filters' ({lowCut, highCut}).
                5. Vocal Analysis: 
                   - Lead: Presence and processing style.
                   - Background: Count EXACT stacks, Mix Type, Stereo Spread, Processing, Tonal Balance, and 'arrangementDetails'.
                6. Match EQ Settings: Specific corrective EQ suggestions for the vocal.
                
                Return the analysis in a clean JSON format with the following structure:
                {
                  "bpm": number,
                  "reverbType": "...",
                  "decayTime": "...",
                  "predelay": "...",
                  "reverbFilters": { "lowCut": 0, "highCut": 20000 },
                  "reverbVisualData": { 
                    "density": 0-100, 
                    "diffusion": 0-100, 
                    "brightness": 0-100,
                    "size": 0-100,
                    "earlyReflections": 0-100,
                    "tailLevel": 0-100,
                    "damping": 0-100
                  },
                  "saturation": { "types": ["..."], "intensity": "...", "description": "..." },
                  "eqProfile": { 
                    "lows": 0-100, "lowMids": 0-100, "highMids": 0-100, "highs": 0-100, "overall": "...",
                    "reverbProfile": { "lows": 0-100, "lowMids": 0-100, "highMids": 0-100, "highs": 0-100 },
                    "delayProfile": { "lows": 0-100, "lowMids": 0-100, "highMids": 0-100, "highs": 0-100 },
                    "saturationProfile": { "lows": 0-100, "lowMids": 0-100, "highMids": 0-100, "highs": 0-100 }
                  },
                  "delays": {
                    "leadVocal": [{"type": "...", "time": "...", "feedback": "...", "level": "...", "pattern": [...], "filters": {"lowCut": 0, "highCut": 20000}}],
                    "backgroundVocals": [{"type": "...", "time": "...", "feedback": "...", "level": "...", "pattern": [...], "filters": {"lowCut": 0, "highCut": 20000}}]
                  },
                  "vocalAnalysis": {
                    "lead": { "presence": "...", "processing": "..." },
                    "background": { "stacks": 0, "mixType": "...", "spread": "...", "processing": "...", "tonalBalance": "...", "arrangementDetails": "..." }
                  },
                  "matchEqSettings": "...",
                  "confidence": 0.0 to 1.0
                }`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
        }
      });

      try {
        const analysis = JSON.parse(response.text || "{}");
        return analysis as AudioAnalysis;
      } catch (e) {
        console.error("Failed to parse Gemini response", e);
        throw new Error("Failed to analyze audio characteristics");
      }
    } catch (e: any) {
      console.error(`Gemini API Error (Attempt ${attempt + 1}):`, e);
      
      const isHighDemand = e.message && (
        e.message.includes("503") || 
        e.message.includes("high demand") || 
        e.message.includes("UNAVAILABLE") || 
        e.message.includes("429")
      );
      
      if (isHighDemand && attempt < maxRetries - 1) {
        attempt++;
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; // Exponential backoff with jitter
        console.log(`High demand detected. Retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // If we've exhausted retries or it's a different error
      if (isHighDemand) {
        throw new Error("The AI model is currently experiencing high demand. Please try again in a few moments.");
      }
      
      // Try to parse the error message if it contains a JSON string
      try {
        const jsonMatch = e.message.match(/\{.*\}/);
        if (jsonMatch) {
          const errorObj = JSON.parse(jsonMatch[0]);
          if (errorObj.error && errorObj.error.message) {
            throw new Error(errorObj.error.message);
          }
        }
      } catch (parseError) {
        // Not a JSON error string, continue to fallback
      }
      
      throw new Error(e.message || "Failed to analyze audio characteristics");
    }
  }
  
  throw new Error("Failed to analyze audio characteristics after multiple attempts");
}
