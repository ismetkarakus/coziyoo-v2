import { create } from 'zustand';
import type { ScreenContext } from '../agent/types';

type ScreenContextState = {
  context: ScreenContext;
  setContext: (context: ScreenContext) => void;
};

const initialContext: ScreenContext = {
  screenName: 'Home',
  routeParams: {},
  visibleProducts: [],
  sessionCapabilities: {
    canPlaceOrder: true,
    hasAddress: false,
    paymentAvailable: false,
  },
};

export const useScreenContextStore = create<ScreenContextState>((set) => ({
  context: initialContext,
  setContext: (context) => set({ context }),
}));
