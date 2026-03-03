/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Activity, Info, RefreshCw, Layers, Volume2, Waves, Zap, Clock, Users, Upload, FileAudio, Flame, Play, Pause, Download, Image as ImageIcon, FileText } from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
import { audioService } from './services/audioService';
import { analyzeAudio, AudioAnalysis, DelayInfo, DelayTap } from './services/geminiService';
import { cn } from './utils/cn';
import { toJpeg } from 'html-to-image';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, BorderStyle, WidthType } from 'docx';

// Helper to convert AudioBuffer to WAV Blob
async function bufferToWav(buffer: AudioBuffer): Promise<Blob> {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const buffer_wav = new ArrayBuffer(length);
  const view = new DataView(buffer_wav);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }

  // write WAVE header
  setUint32(0x46464952);                         // "RIFF"
  setUint32(length - 8);                         // file length - 8
  setUint32(0x45564157);                         // "WAVE"

  setUint32(0x20746d66);                         // "fmt " chunk
  setUint32(16);                                 // length = 16
  setUint16(1);                                  // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan);  // avg. bytes/sec
  setUint16(numOfChan * 2);                      // block-align
  setUint16(16);                                 // 16-bit (hardcoded)

  setUint32(0x61746164);                         // "data" - chunk
  setUint32(length - pos - 4);                   // chunk length

  // write interleaved data
  for(i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while(pos < length) {
    for(i = 0; i < numOfChan; i++) {             // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; // scale to 16-bit signed int
      view.setInt16(pos, sample, true);          // write 16-bit sample
      pos += 2;
    }
    offset++;                                     // next source sample
  }

  return new Blob([buffer_wav], {type: "audio/wav"});
}

// Waveform Editor Component
const WaveformEditor = ({ file, onAnalyze }: { file: File, onAnalyze: (blob: Blob) => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#334155',
      progressColor: '#10b981',
      cursorColor: '#10b981',
      barWidth: 2,
      barGap: 3,
      height: 80,
      normalize: true,
    });

    const regions = ws.registerPlugin(RegionsPlugin.create());

    ws.on('ready', () => {
      // Add a 12-second region at the start
      regions.addRegion({
        start: 0,
        end: 12,
        color: 'rgba(16, 185, 129, 0.2)',
        drag: true,
        resize: true,
      });
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));

    ws.loadBlob(file);
    waveSurferRef.current = ws;

    return () => ws.destroy();
  }, [file]);

  const handlePlayRegion = () => {
    if (!waveSurferRef.current) return;
    const regionsPlugin = waveSurferRef.current.getActivePlugins().find(p => p instanceof RegionsPlugin) as any;
    const region = regionsPlugin?.getRegions()[0];
    if (region) {
      if (isPlaying) {
        waveSurferRef.current.pause();
      } else {
        region.play();
      }
    }
  };

  const handleAnalyzeClick = async () => {
    if (!waveSurferRef.current) return;
    const regions = waveSurferRef.current.getActivePlugins().find(p => p instanceof RegionsPlugin) as any;
    const region = regions?.getRegions()[0];
    if (!region) return;

    // Extract the audio segment
    const audioContext = new AudioContext();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    const startOffset = region.start;
    const endOffset = region.end;
    const duration = endOffset - startOffset;
    
    const segmentBuffer = audioContext.createBuffer(
      audioBuffer.numberOfChannels,
      Math.floor(duration * audioBuffer.sampleRate),
      audioBuffer.sampleRate
    );

    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      const channelData = audioBuffer.getChannelData(i);
      const segmentData = segmentBuffer.getChannelData(i);
      for (let j = 0; j < segmentBuffer.length; j++) {
        segmentData[j] = channelData[Math.floor(startOffset * audioBuffer.sampleRate) + j];
      }
    }

    // Convert buffer to blob (WAV)
    const wavBlob = await bufferToWav(segmentBuffer);
    onAnalyze(wavBlob);
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <button 
            onClick={handlePlayRegion}
            className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-all text-emerald-500 shrink-0"
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-1" />}
          </button>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-emerald-500">Select 12s Section</h4>
            <p className="text-[10px] text-white/40">Drag the highlighted area to select the portion for analysis</p>
          </div>
        </div>
        <button 
          onClick={handleAnalyzeClick}
          className="w-full sm:w-auto px-6 py-2 bg-emerald-500 text-black text-xs font-bold rounded-lg hover:bg-emerald-400 transition-all"
        >
          ANALYZE SELECTION
        </button>
      </div>
      <div ref={containerRef} className="w-full rounded-lg overflow-hidden bg-black/20" />
    </div>
  );
};

const MiniFilterCurve = ({ filters }: { filters?: { lowCut: number, highCut: number } }) => {
  if (!filters) return null;

  const lowX = (Math.log10(filters.lowCut || 20) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)) * 100;
  const highX = (Math.log10(filters.highCut || 20000) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)) * 100;

  const path = `M 0,80 L ${lowX},80 C ${lowX + 5},80 ${lowX + 5},20 ${lowX + 10},20 L ${highX - 10},20 C ${highX - 5},20 ${highX - 5},80 ${highX},80 L 100,80`;

  return (
    <div className="w-full h-10 bg-black/40 rounded border border-white/5 relative p-1">
      <div className="absolute top-0 left-0 right-0 flex justify-between px-1">
        <span className="text-[5px] text-white/20">{filters.lowCut}Hz</span>
        <span className="text-[5px] text-white/20">{filters.highCut >= 1000 ? (filters.highCut / 1000).toFixed(1) + 'k' : filters.highCut}Hz</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full mt-1">
        <path d={path} fill="none" stroke="currentColor" className="text-white/40" strokeWidth="2" />
        <path d={`${path} L 100,100 L 0,100 Z`} fill="currentColor" className="text-white/5" />
      </svg>
    </div>
  );
};

const ProcessingStatus = ({ isAnalyzing }: { isAnalyzing: boolean }) => {
  const [step, setStep] = useState(0);
  const steps = [
    "Initializing Neural Engine...",
    "Vocal Stem Separation...",
    "Vocal Stack Detection...",
    "Harmonic Profile Analysis...",
    "Spectral EQ Mapping...",
    "Reverb & Delay Extraction...",
    "Finalizing Production Summary..."
  ];

  useEffect(() => {
    if (!isAnalyzing) {
      setStep(0);
      return;
    }
    const interval = setInterval(() => {
      setStep(s => (s + 1) % steps.length);
    }, 1500);
    return () => clearInterval(interval);
  }, [isAnalyzing]);

  if (!isAnalyzing) return null;

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="flex items-center gap-3">
        <RefreshCw className="w-5 h-5 animate-spin text-emerald-500" />
        <span className="text-xs font-bold text-emerald-500 tracking-widest uppercase animate-pulse">
          {steps[step]}
        </span>
      </div>
      <div className="w-48 h-1 bg-white/5 rounded-full overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${((step + 1) / steps.length) * 100}%` }}
          className="h-full bg-emerald-500"
        />
      </div>
    </div>
  );
};

const ReverbVisualizer = ({ data, filters }: { data: AudioAnalysis['reverbVisualData'], filters?: AudioAnalysis['reverbFilters'] }) => {
  return (
    <div className="relative w-full bg-black/40 rounded-xl border border-white/5 overflow-hidden p-6">
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        {[...Array(12)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ 
              scale: [0.8, 1.2, 0.8], 
              opacity: [0.1, 0.3, 0.1],
              x: Math.random() * 20 - 10,
              y: Math.random() * 20 - 10
            }}
            transition={{ 
              duration: 3 + Math.random() * 2, 
              repeat: Infinity, 
              delay: i * 0.2 
            }}
            className="absolute inset-0 border border-purple-500/30 rounded-full"
            style={{ 
              margin: `${i * 4}%`,
              filter: `blur(${10 - (data.brightness / 10)}px)`
            }}
          />
        ))}
      </div>
      
      <div className="relative z-10 space-y-6">
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Density', val: data.density },
            { label: 'Diffusion', val: data.diffusion },
            { label: 'Brightness', val: data.brightness },
            { label: 'Size', val: data.size },
            { label: 'Early Ref', val: data.earlyReflections },
            { label: 'Tail Lvl', val: data.tailLevel },
            { label: 'Damping', val: data.damping },
          ].map(item => (
            <div key={item.label} className="text-center bg-black/20 p-2 rounded border border-white/5">
              <span className="text-[7px] text-white/20 block uppercase tracking-widest leading-none mb-1">{item.label}</span>
              <span className="text-[10px] font-bold text-purple-400">{item.val}%</span>
            </div>
          ))}
          <div className="flex items-center justify-center">
             <div className="w-full">
                <MiniFilterCurve filters={filters} />
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const MatchEqCurve = ({ profile }: { profile: AudioAnalysis['eqProfile'] }) => {
  const [visibleCurves, setVisibleCurves] = useState({
    main: true,
    verb: true,
    delay: true,
    sat: true
  });

  const getPathData = (p: { lows: number; lowMids: number; highMids: number; highs: number }) => {
    const bands = [
      { x: 0, y: 100 - p.lows },
      { x: 33, y: 100 - p.lowMids },
      { x: 66, y: 100 - p.highMids },
      { x: 100, y: 100 - p.highs },
    ];
    return `M ${bands[0].x},${bands[0].y} 
      C 15,${bands[0].y} 15,${bands[1].y} ${bands[1].x},${bands[1].y}
      C 50,${bands[1].y} 50,${bands[2].y} ${bands[2].x},${bands[2].y}
      C 85,${bands[2].y} 85,${bands[3].y} ${bands[3].x},${bands[3].y}`;
  };

  const mainPath = getPathData(profile);
  const reverbPath = getPathData(profile.reverbProfile);
  const delayPath = getPathData(profile.delayProfile);
  const saturationPath = getPathData(profile.saturationProfile);

  const toggleCurve = (curve: keyof typeof visibleCurves) => {
    setVisibleCurves(prev => ({ ...prev, [curve]: !prev[curve] }));
  };

  return (
    <div className="relative w-full h-40 bg-white/5 rounded-xl border border-white/5 overflow-hidden p-4">
      <div className="absolute inset-0 p-4">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
          {/* Horizontal Grid lines */}
          {[0, 25, 50, 75, 100].map(y => (
            <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="white" strokeOpacity="0.05" strokeWidth="0.5" />
          ))}
          
          {/* Vertical Grid lines */}
          {[0, 33, 66, 100].map(x => (
            <line key={x} x1={x} y1="0" x2={x} y2="100" stroke="white" strokeOpacity="0.05" strokeWidth="0.5" />
          ))}
          
          {/* Tonal Character Lines (Subtle) */}
          <AnimatePresence>
            {visibleCurves.verb && (
              <motion.path 
                initial={{ opacity: 0 }} animate={{ opacity: 0.4 }} exit={{ opacity: 0 }}
                d={reverbPath} fill="none" stroke="#a855f7" strokeWidth="1.5" 
              />
            )}
            {visibleCurves.delay && (
              <motion.path 
                initial={{ opacity: 0 }} animate={{ opacity: 0.4 }} exit={{ opacity: 0 }}
                d={delayPath} fill="none" stroke="#14b8a6" strokeWidth="1.5" 
              />
            )}
            {visibleCurves.sat && (
              <motion.path 
                initial={{ opacity: 0 }} animate={{ opacity: 0.4 }} exit={{ opacity: 0 }}
                d={saturationPath} fill="none" stroke="#78350f" strokeWidth="1.5" 
              />
            )}

            {/* The Main Curve */}
            {visibleCurves.main && (
              <>
                <motion.path
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 1.5, ease: "easeInOut" }}
                  d={mainPath}
                  fill="none"
                  stroke="#4ade80"
                  strokeWidth="2.5"
                />
                <motion.path
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.2 }}
                  d={mainPath}
                  fill="none"
                  stroke="#4ade80"
                  strokeWidth="8"
                  filter="blur(6px)"
                />
                <motion.path
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.1 }}
                  d={`${mainPath} L 100,100 L 0,100 Z`}
                  fill="#4ade80"
                />
              </>
            )}
          </AnimatePresence>
        </svg>
      </div>
      
      {/* Legend - Interactive */}
      <div className="absolute bottom-2 right-3 flex gap-3 bg-black/40 backdrop-blur-sm px-2 py-1 rounded-full border border-white/5">
        <button 
          onClick={() => toggleCurve('main')}
          className={cn("flex items-center gap-1.5 transition-opacity", !visibleCurves.main && "opacity-30")}
        >
          <div className="w-2 h-2 rounded-full bg-[#4ade80] shadow-[0_0_4px_#4ade80]" />
          <span className="text-[7px] font-bold text-white uppercase tracking-tighter">Main</span>
        </button>
        <button 
          onClick={() => toggleCurve('verb')}
          className={cn("flex items-center gap-1.5 transition-opacity", !visibleCurves.verb && "opacity-30")}
        >
          <div className="w-2 h-2 rounded-full bg-[#a855f7] shadow-[0_0_4px_#a855f7]" />
          <span className="text-[7px] font-bold text-white uppercase tracking-tighter">Verb</span>
        </button>
        <button 
          onClick={() => toggleCurve('delay')}
          className={cn("flex items-center gap-1.5 transition-opacity", !visibleCurves.delay && "opacity-30")}
        >
          <div className="w-2 h-2 rounded-full bg-[#14b8a6] shadow-[0_0_4px_#14b8a6]" />
          <span className="text-[7px] font-bold text-white uppercase tracking-tighter">Delay</span>
        </button>
        <button 
          onClick={() => toggleCurve('sat')}
          className={cn("flex items-center gap-1.5 transition-opacity", !visibleCurves.sat && "opacity-30")}
        >
          <div className="w-2 h-2 rounded-full bg-[#78350f] shadow-[0_0_4px_#78350f]" />
          <span className="text-[7px] font-bold text-white uppercase tracking-tighter">Sat</span>
        </button>
      </div>
    </div>
  );
};

const AdvancedMeter = ({ levels }: { levels: { peak: number, rms: number, lufsST: number } }) => {
  const [lufsI, setLufsI] = useState(-Infinity);
  const [dr, setDr] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setLufsI(levels.rms - 3);
      setDr(Math.max(0, levels.peak - levels.rms));
    }, 200);
    return () => clearInterval(timer);
  }, [levels]);

  const getBarHeight = (db: number) => {
    const min = -60;
    const max = 0;
    return Math.max(0, Math.min(100, ((db - min) / (max - min)) * 100));
  };

  return (
    <div className="flex gap-4 h-full bg-black/20 p-4 rounded-xl border border-white/5">
      {/* L/R Bars */}
      <div className="flex gap-1 h-full">
        {[0, 1].map(i => (
          <div key={i} className="w-2 h-full bg-white/5 rounded-full relative overflow-hidden">
            <motion.div 
              className="absolute bottom-0 left-0 right-0 bg-emerald-500/30"
              animate={{ height: `${getBarHeight(levels.peak)}%` }}
            />
            <motion.div 
              className="absolute bottom-0 left-0 right-0 bg-emerald-400"
              animate={{ height: `${getBarHeight(levels.rms)}%` }}
            />
          </div>
        ))}
      </div>

      {/* Readouts */}
      <div className="flex flex-col justify-between py-1">
        {[
          { label: 'PEAK', val: levels.peak },
          { label: 'RMS', val: levels.rms },
          { label: 'LUFS S', val: levels.lufsST },
          { label: 'LUFS I', val: lufsI },
          { label: 'DR', val: dr }
        ].map(item => (
          <div key={item.label} className="text-right">
            <span className="text-[6px] text-white/20 block uppercase tracking-widest leading-none">{item.label}</span>
            <span className="text-[9px] font-bold text-emerald-400 tabular-nums">
              {item.val === -Infinity ? "-inf" : item.val.toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const DelayPatternVisualizer = ({ pattern }: { pattern?: DelayTap[] }) => {
  if (!pattern || pattern.length === 0) return null;

  return (
    <div className="mt-2 h-16 bg-black/40 rounded-lg border border-white/5 relative overflow-hidden p-2">
      <div className="absolute inset-0 flex items-end justify-around px-2">
        {pattern.map((tap, i) => (
          <motion.div
            key={i}
            initial={{ height: 0 }}
            animate={{ height: `${tap.amplitude * 100}%` }}
            className="w-1 bg-teal-500/60 rounded-t-full relative group"
          >
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[6px] text-white/40 opacity-0 group-hover:opacity-100 transition-opacity">
              {tap.timeMs}ms
            </div>
            <div 
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-teal-400"
              style={{ left: `${(tap.pan + 1) * 50}%` }}
            />
          </motion.div>
        ))}
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-white/10" />
      <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-white/5 border-t border-dashed border-white/5" />
    </div>
  );
};

const DelayCard = ({ title, delays, icon: Icon, showPresets }: { title: string, delays: DelayInfo[], icon: any, showPresets?: boolean }) => (
  <div className="bg-white/5 rounded-xl p-4 border border-white/5 space-y-3 relative overflow-hidden">
    <div className="flex items-center justify-between mb-2 gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="w-3 h-3 text-teal-500 shrink-0" />
        <span className="text-[9px] text-white/40 uppercase tracking-widest truncate">{title}</span>
      </div>
      {showPresets && (
        <div className="flex gap-1 shrink-0">
          {['MODERN', 'VINTAGE', 'LO-FI'].map(p => (
            <button key={p} className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[6px] font-bold hover:bg-white/10 transition-all">
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
    {delays.length > 0 ? (
      <div className="space-y-4">
        {delays.map((d, i) => (
          <div key={i} className="space-y-2">
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2 text-[9px]">
                <div className="bg-black/20 p-2 rounded border border-white/5 min-w-0">
                  <span className="text-white/20 block text-[7px]">TYPE</span>
                  <span className="font-bold text-teal-400 truncate block">{d.type}</span>
                </div>
                <div className="bg-black/20 p-2 rounded border border-white/5 min-w-0">
                  <span className="text-white/20 block text-[7px]">TIME</span>
                  <span className="font-bold truncate block">{d.time}</span>
                </div>
                <div className="bg-black/20 p-2 rounded border border-white/5 min-w-0">
                  <span className="text-white/20 block text-[7px]">FEEDBACK</span>
                  <span className="font-bold truncate block">{d.feedback}</span>
                </div>
                <div className="bg-black/20 p-2 rounded border border-white/5 min-w-0">
                  <span className="text-white/20 block text-[7px]">MIX / LEVEL</span>
                  <span className="font-bold truncate block text-teal-400">{d.level}</span>
                </div>
              </div>
              <MiniFilterCurve filters={d.filters} />
            </div>
            <DelayPatternVisualizer pattern={d.pattern} />
          </div>
        ))}
      </div>
    ) : (
      <p className="text-[9px] text-white/20 italic">No significant delays detected</p>
    )}
  </div>
);

const VocalAnalysisPanel = ({ analysis }: { analysis: AudioAnalysis['vocalAnalysis'] }) => (
  <div className="bg-[#151619] border border-white/10 rounded-2xl p-5 space-y-5 h-full">
    <div className="flex items-center gap-2 border-b border-white/5 pb-3">
      <Users className="w-4 h-4 text-emerald-500" />
      <h3 className="text-[10px] font-bold uppercase tracking-widest">Vocal Stacks & Mix</h3>
    </div>
    
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="w-3 h-3 text-emerald-400" />
          <span className="text-[9px] text-white/40 uppercase tracking-widest">Lead Vocal</span>
        </div>
        <div className="bg-white/5 p-3 rounded-xl border border-white/5 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[9px] text-white/20 uppercase tracking-tight">Presence</span>
            <span className="text-[9px] font-bold text-emerald-400 text-right">{analysis.lead.presence}</span>
          </div>
          <p className="text-[9px] text-white/60 italic leading-relaxed">{analysis.lead.processing}</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Layers className="w-3 h-3 text-emerald-400" />
          <span className="text-[9px] text-white/40 uppercase tracking-widest">Background Stacks</span>
        </div>
        <div className="bg-white/5 p-3 rounded-xl border border-white/5 space-y-3">
          <div className="space-y-2">
            <div className="bg-black/20 p-2 rounded border border-white/5 flex justify-between items-center">
              <span className="text-[7px] text-white/20 uppercase tracking-tight">Stacks</span>
              <span className="text-[10px] font-bold text-emerald-400 text-right">{analysis.background.stacks}</span>
            </div>
            <div className="bg-black/20 p-2 rounded border border-white/5 flex justify-between items-center">
              <span className="text-[7px] text-white/20 uppercase tracking-tight">Mix Type</span>
              <span className="text-[10px] font-bold text-emerald-400 text-right">{analysis.background.mixType}</span>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-[9px] text-white/20 uppercase tracking-tight">Spread</span>
              <span className="text-[9px] font-bold text-right">{analysis.background.spread}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[9px] text-white/20 uppercase tracking-tight">Tonal Balance</span>
              <span className="text-[9px] font-bold text-emerald-400 text-right">{analysis.background.tonalBalance}</span>
            </div>
          </div>
          <div className="bg-emerald-500/5 p-2 rounded border border-emerald-500/10">
            <span className="text-[7px] text-emerald-500/60 uppercase block mb-1">Arrangement</span>
            <p className="text-[9px] text-white/80 leading-tight">{analysis.background.arrangementDetails}</p>
          </div>
          <p className="text-[9px] text-white/60 italic leading-relaxed border-t border-white/5 pt-2">{analysis.background.processing}</p>
        </div>
      </div>
    </div>
  </div>
);

export default function App() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [history, setHistory] = useState<AudioAnalysis[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recordProgress, setRecordProgress] = useState(0);
  const [sensitivity, setSensitivity] = useState(1.0);
  const [bpm, setBpm] = useState<string>("");
  const [startTime, setStartTime] = useState<string>("0");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initializeAudio = async () => {
    try {
      const analyzer = await audioService.initialize();
      analyzerRef.current = analyzer;
      setIsInitialized(true);
      startVisualizer();
    } catch (err) {
      console.error(err);
      setError("Microphone access denied or failed to initialize.");
    }
  };

  const handleSensitivityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setSensitivity(val);
    audioService.setSensitivity(val);
  };

  const startVisualizer = () => {
    if (!canvasRef.current || !analyzerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const analyzer = analyzerRef.current;
    const bufferLength = analyzer.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);
      analyzer.getByteFrequencyData(dataArray);

      ctx.fillStyle = '#151619';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;
        
        // Default neutral color
        let color = '#4ade80'; 

        if (analysis) {
          // After analysis, use tonal colors
          const reverbColor = '#a855f7'; // Purple
          const delayColor = '#14b8a6'; // Teal
          const saturationColor = '#78350f'; // Warm Brown
          
          // Create a dynamic mix based on frequency
          if (i % 3 === 0) color = reverbColor;
          else if (i % 3 === 1) color = delayColor;
          else color = saturationColor;
        }
        
        ctx.fillStyle = color;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }
    };

    draw();
  };

  const handleAnalyze = async () => {
    if (!isInitialized) return;
    
    setIsRecording(true);
    setIsAnalyzing(false);
    setRecordProgress(0);
    audioService.startRecording();

    const duration = 12000; // 12 seconds
    const interval = 100;
    let elapsed = 0;

    const timer = setInterval(() => {
      elapsed += interval;
      setRecordProgress((elapsed / duration) * 100);
      if (elapsed >= duration) {
        clearInterval(timer);
        stopAndProcess();
      }
    }, interval);
  };

  const stopAndProcess = async () => {
    setIsRecording(false);
    setIsAnalyzing(true);
    setError(null);
    try {
      const blob = await audioService.stopRecording();
      const result = await analyzeAudio(blob, bpm ? parseInt(bpm) : undefined);
      
      if (result.confidence === 0) {
        setError(result.matchEqSettings || "No vocals detected. This tool is optimized for vocal production analysis.");
        setAnalysis(null);
      } else {
        setHistory(prev => {
          const newHistory = [result, ...prev];
          return newHistory.slice(0, 3);
        });
        setAnalysis(result);
        // Only update BPM if it's currently in AUTO mode (empty string)
        if (result.bpm && !bpm) {
          setBpm(result.bpm.toString());
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Analysis failed. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile(file);
    setAnalysis(null); // Clear previous analysis when new file is loaded
  };

  const handleAnalyzeSegment = async (blob: Blob) => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeAudio(blob, bpm ? parseInt(bpm) : undefined);
      
      if (result.confidence === 0) {
        setError(result.matchEqSettings || "No vocals detected. This tool is optimized for vocal production analysis.");
        setAnalysis(null);
      } else {
        setHistory(prev => {
          const newHistory = [result, ...prev];
          return newHistory.slice(0, 3);
        });
        setAnalysis(result);
        // Only update BPM if it's currently in AUTO mode (empty string)
        if (result.bpm && !bpm) {
          setBpm(result.bpm.toString());
        }
      }
    } catch (err: any) {
      console.error(err);
      setError("Analysis failed. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const resultsRef = useRef<HTMLDivElement>(null);

  const exportAsImage = async () => {
    if (!resultsRef.current) return;
    try {
      const dataUrl = await toJpeg(resultsRef.current, {
        quality: 0.9,
        backgroundColor: '#0a0a0b',
        pixelRatio: 2,
      });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = 'cx-sonic-analysis.jpg';
      link.click();
    } catch (err) {
      console.error("Failed to export image", err);
      setError("Failed to export image.");
    }
  };

  const exportAsDocx = async () => {
    if (!analysis) return;
    
    try {
      const doc = new Document({
        sections: [{
          properties: {},
          children: [
            new Paragraph({
              text: "CX SONIC ANALYZER - Production Summary",
              heading: HeadingLevel.HEADING_1,
            }),
            new Paragraph({ text: "" }),
            new Paragraph({
              text: `Confidence: ${(analysis.confidence * 100).toFixed(0)}%`,
              heading: HeadingLevel.HEADING_2,
            }),
            new Paragraph({ text: "" }),
            new Paragraph({
              text: "Match EQ Curve & Summary",
              heading: HeadingLevel.HEADING_2,
            }),
            new Paragraph({ text: `Overall EQ Balance: ${analysis.eqProfile.overall}` }),
            new Paragraph({ text: `Match EQ Settings: ${analysis.matchEqSettings}` }),
            new Paragraph({ text: "" }),
            new Paragraph({
              text: "Vocal Stacks & Mix",
              heading: HeadingLevel.HEADING_2,
            }),
            new Paragraph({ text: `Lead Vocal Presence: ${analysis.vocalAnalysis.lead.presence}` }),
            new Paragraph({ text: `Lead Vocal Processing: ${analysis.vocalAnalysis.lead.processing}` }),
            new Paragraph({ text: `Background Stacks: ${analysis.vocalAnalysis.background.stacks}` }),
            new Paragraph({ text: `Background Mix Type: ${analysis.vocalAnalysis.background.mixType}` }),
            new Paragraph({ text: `Background Spread: ${analysis.vocalAnalysis.background.spread}` }),
            new Paragraph({ text: `Background Tonal Balance: ${analysis.vocalAnalysis.background.tonalBalance}` }),
            new Paragraph({ text: `Background Arrangement: ${analysis.vocalAnalysis.background.arrangementDetails}` }),
            new Paragraph({ text: `Background Processing: ${analysis.vocalAnalysis.background.processing}` }),
            new Paragraph({ text: "" }),
            new Paragraph({
              text: "Reverb Visualizer",
              heading: HeadingLevel.HEADING_2,
            }),
            new Paragraph({ text: `Type: ${analysis.reverbType}` }),
            new Paragraph({ text: `Density: ${analysis.reverbVisualData.density}%` }),
            new Paragraph({ text: `Diffusion: ${analysis.reverbVisualData.diffusion}%` }),
            new Paragraph({ text: `Brightness: ${analysis.reverbVisualData.brightness}%` }),
            new Paragraph({ text: `Size: ${analysis.reverbVisualData.size}%` }),
            new Paragraph({ text: `Early Reflections: ${analysis.reverbVisualData.earlyReflections}%` }),
            new Paragraph({ text: `Tail Level: ${analysis.reverbVisualData.tailLevel}%` }),
            new Paragraph({ text: `Damping: ${analysis.reverbVisualData.damping}%` }),
            new Paragraph({ text: "" }),
            new Paragraph({
              text: "Saturation",
              heading: HeadingLevel.HEADING_2,
            }),
            new Paragraph({ text: `Types: ${analysis.saturation.types.join(', ')}` }),
            new Paragraph({ text: `Intensity: ${analysis.saturation.intensity}` }),
            new Paragraph({ text: `Description: ${analysis.saturation.description}` }),
          ],
        }],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'cx-sonic-analysis.docx';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export docx", err);
      setError("Failed to export document.");
    }
  };

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      audioService.cleanup();
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white font-mono selection:bg-emerald-500/30">
      {/* Top Header */}
      <header className="border-b border-white/5 p-4 sm:p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[#151619]/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
            <Activity className="text-black w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h1 className="text-sm sm:text-lg font-bold tracking-tighter uppercase">CX SONIC ANALYZER</h1>
            <p className="text-[8px] sm:text-[10px] text-white/40 uppercase tracking-widest">Acoustic Fingerprinting Unit v3.0</p>
          </div>
        </div>
        
        <div className="flex items-center justify-between w-full sm:w-auto gap-4">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept="audio/*,.mp3,.wav,.m4a,.flac,.aac,.ogg" 
            className="hidden" 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 p-2 sm:px-4 sm:py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-bold hover:bg-white/10 transition-all flex-1 sm:flex-none"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">UPLOAD FILE</span>
          </button>
          
          <div className="flex flex-col items-end">
            <span className="text-[8px] sm:text-[10px] text-white/40 uppercase tracking-widest">System Status</span>
            <div className="flex items-center gap-2">
              <div className={cn("w-2 h-2 rounded-full animate-pulse", isInitialized ? "bg-emerald-500" : "bg-red-500")} />
              <span className="text-[10px] sm:text-xs font-bold">{isInitialized ? "ONLINE" : "OFFLINE"}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="w-full px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Info & History */}
        <div className="lg:col-span-3 space-y-6">
          {!analysis && (
            <section className="bg-[#151619] border border-white/10 rounded-2xl p-5 space-y-5">
              <div className="flex flex-col items-center justify-center py-10 text-center space-y-4">
                <div className="w-10 h-10 border border-dashed border-white/10 rounded-full flex items-center justify-center">
                  <Info className="w-5 h-5 text-white/10" />
                </div>
                <p className="text-[9px] text-white/30 uppercase tracking-widest">Waiting for input analysis...</p>
              </div>
            </section>
          )}

          <section className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-5 space-y-4">
            <h4 className="text-[9px] font-bold uppercase tracking-widest text-emerald-500">Analysis Engine v3.0</h4>
            <ul className="space-y-3">
              {[
                "12-second high-fidelity capture window",
                "Vocal stack & harmony mix detection",
                "Saturation & harmonic profile detection",
                "Tonal theme visualization after analysis",
                "Integrated Match EQ & Production Summary",
                "Delay pattern & tap visualization"
              ].map((text, i) => (
                <li key={i} className="flex gap-3 text-[10px] text-white/60">
                  <span className="text-emerald-500 font-bold">0{i+1}</span>
                  {text}
                </li>
              ))}
            </ul>
          </section>

          {history.length > 0 && (
            <section className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
              <h4 className="text-[9px] font-bold uppercase tracking-widest text-emerald-500">Analysis History</h4>
              <div className="space-y-3">
                {history.map((item, i) => (
                  <div 
                    key={i} 
                    className="bg-black/20 p-3 rounded-xl border border-white/5 cursor-pointer hover:bg-white/5 transition-all" 
                    onClick={() => setAnalysis(item)}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold text-white/80">Analysis {history.length - i}</span>
                      <span className="text-[8px] text-emerald-500">{(item.confidence * 100).toFixed(0)}% Match</span>
                    </div>
                    <p className="text-[9px] text-white/40 truncate">{item.eqProfile.overall}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right Column: Visualizer & Controls */}
        <div className="lg:col-span-9 space-y-6">
          {/* Main Visualizer Widget */}
          <section className="bg-[#151619] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
              <div className="flex items-center gap-2">
                <Waves className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-bold uppercase tracking-widest">Real-time Spectral Analysis</span>
              </div>
              <div className="flex items-center gap-4 text-[10px] text-white/40 uppercase">
                <span>20Hz</span>
                <div className="w-32 h-[1px] bg-white/10" />
                <span>20kHz</span>
              </div>
            </div>
            
            <div className="relative h-72 bg-[#0a0a0b]">
              {!isInitialized ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0a0a0b]/80 backdrop-blur-sm z-10">
                  <Mic className="w-12 h-12 text-white/20" />
                  <button 
                    onClick={initializeAudio}
                    className="px-8 py-3 bg-emerald-500 text-black font-bold rounded-full hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20 active:scale-95"
                  >
                    INITIALIZE MICROPHONE
                  </button>
                  <p className="text-xs text-white/40 max-w-xs text-center">
                    Requires microphone access to analyze ambient audio or direct input.
                  </p>
                </div>
              ) : null}
              <canvas 
                ref={canvasRef} 
                width={800} 
                height={400} 
                className="w-full h-full"
              />
              
              {/* Overlay for recording state */}
              <AnimatePresence>
                {isRecording && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-red-500/10 flex flex-col items-center justify-center pointer-events-none"
                  >
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-4 h-4 bg-red-500 rounded-full animate-ping" />
                      <span className="text-red-500 font-bold text-xl tracking-tighter animate-pulse uppercase">Capturing 12s Sample...</span>
                      <div className="w-64 h-1 bg-white/10 rounded-full overflow-hidden mt-4">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${recordProgress}%` }}
                          className="h-full bg-red-500"
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="p-4 sm:p-6 bg-white/5 flex flex-col md:flex-row items-center justify-between gap-6 md:gap-8">
              <div className="w-full flex-1 flex flex-col sm:flex-row gap-6 sm:gap-8 items-center">
                <div className="flex flex-col w-full flex-1">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] text-white/40 uppercase tracking-widest">Input Sensitivity</span>
                    <span className="text-[10px] font-bold text-emerald-500">{(sensitivity * 100).toFixed(0)}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="2" 
                    step="0.01" 
                    value={sensitivity} 
                    onChange={handleSensitivityChange}
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>
                
                <div className="flex flex-col w-full sm:w-auto items-center sm:items-start">
                  <span className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Gain Level</span>
                  <div className="flex gap-1">
                    {[1,2,3,4,5,6,7,8].map(i => (
                      <div key={i} className={cn("w-1 h-4 rounded-full", i < (sensitivity * 4) ? "bg-emerald-500/50" : "bg-white/10")} />
                    ))}
                  </div>
                </div>
              </div>

              <button
                onClick={handleAnalyze}
                disabled={!isInitialized || isRecording || isAnalyzing}
                className={cn(
                  "w-full md:w-auto flex items-center justify-center gap-3 px-10 py-4 rounded-xl font-bold transition-all shadow-2xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed",
                  isRecording ? "bg-red-500 text-white" : "bg-white text-black hover:bg-white/90"
                )}
              >
                {isRecording ? (
                  <>
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                    RECORDING...
                  </>
                ) : isAnalyzing ? (
                  <ProcessingStatus isAnalyzing={isAnalyzing} />
                ) : (
                  <>
                    <Zap className="w-5 h-5 fill-current" />
                    ANALYZE PRODUCTION (12S)
                  </>
                )}
              </button>
            </div>
          </section>

          {uploadedFile && !analysis && (
            <WaveformEditor 
              file={uploadedFile} 
              onAnalyze={handleAnalyzeSegment} 
            />
          )}

          {/* Error Message */}
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-3"
            >
              <Info className="w-5 h-5" />
              {error}
              <button onClick={() => setError(null)} className="ml-auto text-xs underline">Dismiss</button>
            </motion.div>
          )}

          {/* Analysis Results */}
          <AnimatePresence>
            {analysis && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-white/5 border border-white/10 rounded-xl p-4 gap-4">
                  <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-500 flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Analysis Complete
                  </h2>
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <button 
                      onClick={exportAsImage}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[10px] font-bold hover:bg-white/10 transition-all uppercase tracking-widest"
                    >
                      <ImageIcon className="w-3 h-3" />
                      Export JPG
                    </button>
                    <button 
                      onClick={exportAsDocx}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[10px] font-bold hover:bg-white/10 transition-all uppercase tracking-widest"
                    >
                      <FileText className="w-3 h-3" />
                      Export DOCX
                    </button>
                  </div>
                </div>

                <div ref={resultsRef} className="space-y-6 p-4 -mx-4 sm:p-0 sm:mx-0 bg-[#0a0a0b]">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                    {/* EQ Profile Panel + Summary */}
                    <div className="md:col-span-8 bg-[#151619] border border-white/10 rounded-2xl p-5 space-y-5">
                      <div className="flex items-center justify-between border-b border-white/5 pb-3">
                        <div className="flex items-center gap-2">
                          <Volume2 className="w-4 h-4 text-emerald-500" />
                          <h3 className="text-[10px] font-bold uppercase tracking-widest">Match EQ Curve & Summary</h3>
                        </div>
                        <div className="flex items-center gap-2 text-[9px] text-white/40 uppercase tracking-widest">
                          <span>Confidence:</span>
                          <span className="text-emerald-500 font-bold">{(analysis.confidence * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <MatchEqCurve profile={analysis.eqProfile} />
                      <div className="space-y-3">
                        <div className="flex gap-3">
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex-1">
                            <span className="text-[9px] text-white/40 uppercase tracking-widest block mb-2">Overall EQ Balance</span>
                            <p className="text-[10px] text-white/80 leading-relaxed">{analysis.eqProfile.overall}</p>
                          </div>
                        </div>
                        <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                          <span className="text-[9px] text-white/40 uppercase tracking-widest block mb-2">Match EQ Settings</span>
                          <p className="text-[10px] text-emerald-400/80 leading-relaxed italic">"{analysis.matchEqSettings}"</p>
                        </div>
                        <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                          <div className="flex items-center gap-2 mb-2">
                            <Flame className="w-3 h-3 text-amber-700" />
                            <span className="text-[9px] text-white/40 uppercase tracking-widest">Saturation Profile</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {analysis.saturation.types.map((type, i) => (
                              <span key={`${type}-${i}`} className="px-2 py-0.5 bg-amber-700/10 border border-amber-700/20 rounded text-[9px] font-bold text-amber-600 uppercase">
                                {type}
                              </span>
                            ))}
                          </div>
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-[9px] text-white/40 uppercase tracking-widest">Intensity</span>
                            <span className="text-[10px] font-bold text-amber-600">{analysis.saturation.intensity}</span>
                          </div>
                          <p className="text-[9px] text-white/60 leading-relaxed italic border-t border-white/5 pt-2">
                            {analysis.saturation.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Vocal Analysis Panel */}
                  <div className="md:col-span-4">
                    <VocalAnalysisPanel analysis={analysis.vocalAnalysis} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Delay Analyzer */}
                  <div className="bg-[#151619] border border-white/10 rounded-2xl p-5 space-y-5">
                    <div className="flex items-center gap-2 border-b border-white/5 pb-3">
                      <Clock className="w-4 h-4 text-teal-500" />
                      <h3 className="text-[10px] font-bold uppercase tracking-widest">Delay Analyzer</h3>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-4">
                      <DelayCard 
                        title="Lead Vocal" 
                        delays={analysis.delays.leadVocal} 
                        icon={Zap} 
                        showPresets
                      />
                      <DelayCard 
                        title="Background Vocals" 
                        delays={analysis.delays.backgroundVocals} 
                        icon={Users} 
                      />
                    </div>
                  </div>

                  {/* Reverb Panel */}
                  <div className="bg-[#151619] border border-white/10 rounded-2xl p-5 space-y-5">
                    <div className="flex justify-between items-center border-b border-white/5 pb-3">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-purple-500" />
                        <h3 className="text-[10px] font-bold uppercase tracking-widest">Reverb Visualizer</h3>
                      </div>
                      <span className="text-[9px] font-bold text-purple-400 uppercase tracking-widest">{analysis.reverbType}</span>
                    </div>
                    
                    <ReverbVisualizer data={analysis.reverbVisualData} filters={analysis.reverbFilters} />

                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                        <span className="text-[9px] text-white/20 uppercase tracking-widest block mb-1">Decay Time</span>
                        <span className="text-lg font-bold">{analysis.decayTime}</span>
                      </div>
                      <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                        <span className="text-[9px] text-white/20 uppercase tracking-widest block mb-1">Predelay</span>
                        <span className="text-lg font-bold">{analysis.predelay}</span>
                      </div>
                    </div>
                  </div>
                </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto p-8 border-t border-white/5 flex justify-between items-center text-[10px] text-white/20 uppercase tracking-[0.2em]">
        <span>© 2026 Sonic Analysis Systems</span>
        <span>Encrypted Link: Secure</span>
      </footer>
    </div>
  );
}
