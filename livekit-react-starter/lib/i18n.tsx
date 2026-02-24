'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Locale = 'en' | 'tr';

type Dictionary = Record<string, string>;

const dictionaries: Record<Locale, Dictionary> = {
  en: {
    language: 'Language',
    startSession: 'Start session',
    welcomeSubtitle: 'Chat live with your voice AI agent',
    username: 'Username',
    roomName: 'Room Name',
    setupHelp: 'Need help getting set up? Check out the',
    quickstart: 'Voice AI quickstart',
    recordAndTranscribe: 'Record and transcribe',
    stopRecording: 'Stop recording',
    startAutoListen: 'Start auto listen (VAD)',
    stopAutoListen: 'Stop auto listen',
    typeSomething: 'Type something...',
    sending: 'Sending...',
    send: 'Send',
    endCall: 'END CALL',
    end: 'END',
    tools: 'Tools',
    toolsDescription: 'n8n tool trigger panel',
    n8nConfigured: 'n8n configured',
    n8nNotConfigured: 'n8n not configured',
    n8nReachable: 'reachable',
    n8nUnreachable: 'unreachable',
    refreshTools: 'Refresh tools',
    noToolsFound: 'No tools found in registry.',
    toolInputPlaceholder: 'Optional input payload',
    runTool: 'Run tool',
    running: 'Running...',
    runOk: 'Tool executed',
    runFailed: 'Tool run failed',
    agentListening: 'Agent is listening, ask it a question',
  },
  tr: {
    language: 'Dil',
    startSession: 'Oturumu baslat',
    welcomeSubtitle: 'Sesli AI ajanin ile canli gorus',
    username: 'Kullanici adi',
    roomName: 'Oda adi',
    setupHelp: 'Kurulum icin su dokumana bak:',
    quickstart: 'Voice AI quickstart',
    recordAndTranscribe: 'Kaydet ve yaziya cevir',
    stopRecording: 'Kaydi durdur',
    startAutoListen: 'Otomatik dinleme baslat (VAD)',
    stopAutoListen: 'Otomatik dinlemeyi durdur',
    typeSomething: 'Bir sey yaz...',
    sending: 'Gonderiliyor...',
    send: 'Gonder',
    endCall: 'GORUSMEYI BITIR',
    end: 'BITIR',
    tools: 'Araclar',
    toolsDescription: 'n8n arac tetikleme paneli',
    n8nConfigured: 'n8n tanimli',
    n8nNotConfigured: 'n8n tanimli degil',
    n8nReachable: 'erisilebilir',
    n8nUnreachable: 'erisilemiyor',
    refreshTools: 'Araclari yenile',
    noToolsFound: 'Registry icinde arac bulunamadi.',
    toolInputPlaceholder: 'Opsiyonel girdi',
    runTool: 'Araci calistir',
    running: 'Calisiyor...',
    runOk: 'Arac calistirildi',
    runFailed: 'Arac calistirma basarisiz',
    agentListening: 'Ajan dinliyor, soru sorabilirsin',
  },
};

type I18nContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const stored = window.localStorage.getItem('coziyoo.starter.locale');
    if (stored === 'tr' || stored === 'en') {
      setLocaleState(stored);
      return;
    }
    const language = window.navigator.language.toLowerCase();
    if (language.startsWith('tr')) {
      setLocaleState('tr');
    }
  }, []);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem('coziyoo.starter.locale', next);
  };

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key: string) => dictionaries[locale][key] ?? dictionaries.en[key] ?? key,
    }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}
