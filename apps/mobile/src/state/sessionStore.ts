import { create } from 'zustand';
import type { LoginResponse, StartSessionResponse } from '../types/api';

type SessionState = {
  auth: LoginResponse | null;
  livekitSession: StartSessionResponse | null;
  selectedDeviceId: string;
  settingsProfileId?: string;
  setAuth: (auth: LoginResponse | null) => void;
  setLivekitSession: (session: StartSessionResponse | null) => void;
  setDeviceId: (deviceId: string) => void;
  setSettingsProfileId: (id?: string) => void;
};

const defaultDeviceId = process.env.EXPO_PUBLIC_DEFAULT_DEVICE_ID ?? 'mobile_dev_001';

export const useSessionStore = create<SessionState>((set) => ({
  auth: null,
  livekitSession: null,
  selectedDeviceId: defaultDeviceId,
  settingsProfileId: undefined,
  setAuth: (auth) => set({ auth }),
  setLivekitSession: (livekitSession) => set({ livekitSession }),
  setDeviceId: (selectedDeviceId) => set({ selectedDeviceId }),
  setSettingsProfileId: (settingsProfileId) => set({ settingsProfileId }),
}));
