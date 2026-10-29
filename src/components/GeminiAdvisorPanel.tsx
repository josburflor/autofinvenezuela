import React, { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  MessageSquareText,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  X,
} from 'lucide-react';
import type { AdvisorProfileDTO, LeadRecordDTO } from '../shared/types';
import { apiFetch, websocketUrl } from '../lib/api-url';

interface GeminiAdvisorPanelProps {
  open: boolean;
  onClose: () => void;
  activeLead: LeadRecordDTO | null;
  isAdvisorMode: boolean;
  advisorProfile: AdvisorProfileDTO;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  modelTag?: string;
}

function float32ToPcm16Base64(float32Array: Float32Array): string {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function pcm16Base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const pcm16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / 32768.0;
  }
  return float32;
}

export function GeminiAdvisorPanel({
  open,
  onClose,
  activeLead,
  isAdvisorMode,
  advisorProfile,
  authFetch,
}: GeminiAdvisorPanelProps) {
  const [panelTab, setPanelTab] = useState<'chat' | 'voice'>('chat');

  const buildWelcomeMessage = (advisorView: boolean, advisorName: string): ChatMessage => ({
    id: 'welcome',
    role: 'model',
    text: advisorView
      ? `Hola ${advisorName}, soy tu Asistente Comercial IA de Autofin Venezuela. Puedo ayudarte a simular cuotas a 60 meses, redactar mensajes de seguimiento para WhatsApp o preparar argumentos comerciales para vehículos, motos e inmuebles.`
      : `Hola, bienvenido a Autofin Venezuela. Soy el Asistente de IA del equipo de tu asesor ${advisorName}. Puedo explicarte nuestros planes a 60 cuotas para vehículos, motos e inmuebles o calcular tu inicial estimada.`,
    modelTag: 'gemini-3.8-flash',
  });

  // Multi-turn Chat State
  const [chatMode, setChatMode] = useState<'standard' | 'fast'>('standard');
  const [messages, setMessages] = useState<ChatMessage[]>([
    buildWelcomeMessage(isAdvisorMode, advisorProfile.advisorName),
  ]);
  const [inputText, setInputText] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  // Live API Voice State (gemini-3.8-live)
  const [voiceConnected, setVoiceConnected] = useState(false);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [liveTranscripts, setLiveTranscripts] = useState<
    Array<{ speaker: 'Asesor' | 'Gemini'; text: string }>
  >([]);

  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sendingChat]);

  const stopVoiceSession = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }
    activeSourcesRef.current.forEach((s) => {
      try {
        s.stop();
      } catch {
        // ignore
      }
    });
    activeSourcesRef.current = [];
    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    nextStartTimeRef.current = 0;
    setVoiceConnected(false);
    setVoiceConnecting(false);
  };

  useEffect(() => {
    if (!isAdvisorMode && panelTab === 'voice') {
      stopVoiceSession();
      setPanelTab('chat');
    }
    setMessages((prev) =>
      prev.length <= 1
        ? [buildWelcomeMessage(isAdvisorMode, advisorProfile.advisorName)]
        : prev
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdvisorMode, advisorProfile.advisorName]);

  useEffect(() => {
    if (!open) {
      stopVoiceSession();
    }
    return () => {
      stopVoiceSession();
    };
  }, [open]);

  const leadContextSummary = activeLead
    ? `Cliente: ${activeLead.firstName} ${activeLead.lastName} (${activeLead.city}), Presupuesto inicial: $${activeLead.availableAmount}, Estado: ${activeLead.status}, Interés: ${
        (activeLead.interestType === 'vehiculo' || activeLead.interestType === 'moto') &&
        activeLead.vehicleRequest
          ? `${activeLead.interestType === 'moto' ? 'Moto' : 'Vehículo'} ${activeLead.vehicleRequest.condition} ${activeLead.vehicleRequest.brand} ${activeLead.vehicleRequest.model} ${activeLead.vehicleRequest.year}`
          : 'Inmueble comercial/residencial visto'
      }.`
    : '';

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || sendingChat) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };

    const historyForApi = messages
      .filter((m) => m.id !== 'welcome')
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setSendingChat(true);
    setChatError(null);

    try {
      const res = isAdvisorMode
        ? await authFetch('/api/gemini/chat', {
            method: 'POST',
            body: JSON.stringify({
              message: trimmed,
              history: historyForApi,
              mode: chatMode,
              leadContext: leadContextSummary,
            }),
          })
        : await apiFetch('/api/public/gemini/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: trimmed,
              history: historyForApi,
            }),
          });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al obtener respuesta del Asistente de IA.');
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `m-${Date.now()}`,
          role: 'model',
          text: data.reply,
          modelTag: data.model,
        },
      ]);
    } catch (err: unknown) {
      setChatError(
        err instanceof Error ? err.message : 'No se pudo conectar con el servicio Gemini.'
      );
    } finally {
      setSendingChat(false);
    }
  };

  const startVoiceSession = async () => {
    setVoiceError(null);
    setVoiceConnecting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputAudioCtxRef.current = inputCtx;
      outputAudioCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const query = leadContextSummary
        ? `?lead=${encodeURIComponent(leadContextSummary)}`
        : '';
      const ws = new WebSocket(websocketUrl(`/live${query}`));
      wsRef.current = ws;

      ws.onopen = () => {
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (event) => {
          const socket = wsRef.current;
          if (!socket || socket.readyState !== WebSocket.OPEN) return;
          const channelData = event.inputBuffer.getChannelData(0);
          const base64Audio = float32ToPcm16Base64(channelData);
          socket.send(JSON.stringify({ audio: base64Audio }));
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.status === 'connected') {
            setVoiceConnected(true);
            setVoiceConnecting(false);
          }
          if (msg.error) {
            setVoiceError(msg.error);
            stopVoiceSession();
            return;
          }
          if (msg.interrupted) {
            activeSourcesRef.current.forEach((src) => {
              try {
                src.stop();
              } catch {
                // ignore
              }
            });
            activeSourcesRef.current = [];
            if (outputAudioCtxRef.current) {
              nextStartTimeRef.current = outputAudioCtxRef.current.currentTime;
            }
          }
          if (msg.audio && outputAudioCtxRef.current) {
            const outCtx = outputAudioCtxRef.current;
            const float32 = pcm16Base64ToFloat32(msg.audio);
            const audioBuffer = outCtx.createBuffer(1, float32.length, 24000);
            audioBuffer.getChannelData(0).set(float32);

            const bufferSource = outCtx.createBufferSource();
            bufferSource.buffer = audioBuffer;
            bufferSource.connect(outCtx.destination);

            const startTime = Math.max(outCtx.currentTime, nextStartTimeRef.current);
            bufferSource.start(startTime);
            nextStartTimeRef.current = startTime + audioBuffer.duration;
            activeSourcesRef.current.push(bufferSource);

            bufferSource.onended = () => {
              activeSourcesRef.current = activeSourcesRef.current.filter(
                (s) => s !== bufferSource
              );
            };
          }
          if (msg.inputTranscript) {
            setLiveTranscripts((prev) => [
              ...prev.slice(-14),
              { speaker: 'Asesor', text: msg.inputTranscript },
            ]);
          }
          if (msg.outputTranscript) {
            setLiveTranscripts((prev) => [
              ...prev.slice(-14),
              { speaker: 'Gemini', text: msg.outputTranscript },
            ]);
          }
        } catch {
          // ignore malformed chunk
        }
      };

      ws.onerror = () => {
        setVoiceError('Error de red en el canal de voz en tiempo real.');
        stopVoiceSession();
      };

      ws.onclose = () => {
        setVoiceConnected(false);
        setVoiceConnecting(false);
      };
    } catch (err: unknown) {
      setVoiceError(
        err instanceof Error
          ? err.message
          : 'Permiso de micrófono denegado o no disponible.'
      );
      stopVoiceSession();
    }
  };

  if (!open) return null;

  return (
    <div className="no-print fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[1px]">
      <div className="w-full max-w-lg bg-white h-full border-l border-slate-200 shadow-xl flex flex-col">
        {/* Cabecera */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {isAdvisorMode
                ? 'Asistente Comercial del Asesor (IA)'
                : 'Asistente de IA — Autofin Venezuela'}
            </h2>
            <p className="text-xs text-slate-500">
              {isAdvisorMode
                ? activeLead
                  ? `Contexto activo: ${activeLead.firstName} ${activeLead.lastName}`
                  : `Soporte comercial para ${advisorProfile.advisorName}`
                : `Orientación en línea sobre planes · Asesor: ${advisorProfile.advisorName}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar asistente IA"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:text-slate-900 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            <X className="w-4 h-4" />
            <span>Cerrar</span>
          </button>
        </div>

        {/* Selector de Modo (Solo en Panel Administrativo se habilita entrenamiento de voz y modo rápido) */}
        {isAdvisorMode && (
          <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
              <button
                type="button"
                onClick={() => setPanelTab('chat')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  panelTab === 'chat'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <MessageSquareText className="w-3.5 h-3.5" />
                <span>Chat Multi-turno</span>
              </button>
              <button
                type="button"
                onClick={() => setPanelTab('voice')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  panelTab === 'voice'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <AudioLines className="w-3.5 h-3.5" />
                <span>Voz en Vivo (Live API)</span>
              </button>
            </div>

            {panelTab === 'chat' && (
              <select
                value={chatMode}
                onChange={(e) => setChatMode(e.target.value as 'standard' | 'fast')}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-700"
              >
                <option value="standard">Análisis Completo (3.8 Flash)</option>
                <option value="fast">WhatsApp Rápido (3.1 Flash Lite)</option>
              </select>
            )}
          </div>
        )}

        {panelTab === 'chat' ? (
          <>
            {/* Hilo de Conversación Multi-turno */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${
                    m.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div
                    className={`max-w-[88%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-sky-700 text-white'
                        : 'bg-slate-100 text-slate-900 border border-slate-200'
                    }`}
                  >
                    {m.text}
                  </div>
                  <span className="text-[11px] text-slate-400 mt-1 font-mono">
                    {m.role === 'user' ? (isAdvisorMode ? 'Asesor' : 'Cliente') : 'Asistente Autofin'}
                  </span>
                </div>
              ))}

              {sendingChat && (
                <div className="text-xs text-slate-500 font-medium">
                  Consultando planes Autofin Venezuela...
                </div>
              )}

              {chatError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                  {chatError}
                </div>
              )}
              <div ref={scrollEndRef} />
            </div>

            {/* Sugerencias Rápidas + Input */}
            <div className="p-4 border-t border-slate-200 bg-white space-y-3 shrink-0">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {(isAdvisorMode
                  ? [
                      'Redacta seguimiento WhatsApp para Livan X3 Pro',
                      'Compara Plan 24 cuotas vs Entrega Rápida 37%',
                      'Requisitos para inmueble comercial visto',
                    ]
                  : [
                      '¿Cómo funciona el plan a 60 cuotas para un carro?',
                      'Quiero financiar una moto nueva de $2,280',
                      '¿Qué necesito para solicitar un inmueble?',
                    ]
                ).map((promptSuggestion) => (
                  <button
                    key={promptSuggestion}
                    type="button"
                    onClick={() => setInputText(promptSuggestion)}
                    className="px-2.5 py-1 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap shrink-0"
                  >
                    {promptSuggestion}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSendChat} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setMessages([buildWelcomeMessage(isAdvisorMode, advisorProfile.advisorName)])
                  }
                  title="Reiniciar conversación"
                  className="p-2.5 text-slate-500 hover:text-slate-900 bg-slate-100 rounded-lg shrink-0"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={
                    isAdvisorMode
                      ? 'Escribe tu consulta comercial o pide un guion...'
                      : 'Pregunta sobre cuotas, motos, vehículos o inmuebles...'
                  }
                  className="flex-1 px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
                <button
                  type="submit"
                  disabled={sendingChat || !inputText.trim()}
                  className="p-2.5 text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-50 shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </>
        ) : (
          /* Pestaña de Conversación de Voz en Tiempo Real (gemini-3.8-live) */
          <div className="flex-1 p-6 flex flex-col justify-between gap-6 overflow-y-auto">
            <div className="space-y-4">
              <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-4">
                <div className="w-14 h-14 mx-auto rounded-full bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700">
                  {voiceConnected ? (
                    <Mic className="w-6 h-6 text-emerald-700" />
                  ) : (
                    <MicOff className="w-6 h-6 text-slate-400" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {voiceConnected
                      ? 'Sesión de Voz Activa (gemini-3.8-live)'
                      : voiceConnecting
                        ? 'Conectando audio bidireccional...'
                        : 'Asesoría por Voz en Tiempo Real'}
                  </h3>
                  <p className="text-xs text-slate-600 mt-1 max-w-sm mx-auto leading-relaxed">
                    Practica el manejo de objeciones antes de llamar al cliente o consulta cálculos
                    de inicial a manos libres mediante Gemini Live API.
                  </p>
                </div>

                {voiceError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 text-left">
                    {voiceError}
                  </div>
                )}

                <div>
                  {!voiceConnected ? (
                    <button
                      type="button"
                      disabled={voiceConnecting}
                      onClick={startVoiceSession}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors"
                    >
                      <Mic className="w-4 h-4" />
                      <span>
                        {voiceConnecting ? 'Iniciando micrófono...' : 'Iniciar Conversación de Voz'}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopVoiceSession}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                    >
                      <MicOff className="w-4 h-4" />
                      <span>Finalizar Sesión de Voz</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Transcripción en Vivo */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-700">
                  Transcripción de la Sesión
                </h4>
                <div className="min-h-[180px] max-h-[280px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 space-y-2 text-xs">
                  {liveTranscripts.length === 0 ? (
                    <p className="text-slate-400">
                      Al iniciar la conversación, verás aquí la transcripción de voz en tiempo
                      real.
                    </p>
                  ) : (
                    liveTranscripts.map((item, idx) => (
                      <div key={idx} className="leading-relaxed">
                        <strong className="text-slate-900">{item.speaker}:</strong>{' '}
                        <span className="text-slate-700">{item.text}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
