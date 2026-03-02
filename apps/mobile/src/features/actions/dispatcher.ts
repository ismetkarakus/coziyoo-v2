import type { NavigationContainerRef } from '@react-navigation/native';
import type { RefObject } from 'react';
import type { ValidAgentActionEnvelope } from './schema';

type DispatcherDependencies = {
  navigationRef: RefObject<NavigationContainerRef<any>>;
  onAppendNote: (text: string) => void;
  onSettingsHint: (message: string) => void;
};

export function dispatchAgentAction(message: ValidAgentActionEnvelope, deps: DispatcherDependencies) {
  const action = message.action;

  switch (action.name) {
    case 'navigate': {
      deps.navigationRef.current?.navigate(action.params.screen, {
        prefill: action.params.prefill,
      });
      return;
    }
    case 'open_profile': {
      deps.navigationRef.current?.navigate('Profile', {
        userId: action.params.userId,
      });
      return;
    }
    case 'append_note': {
      deps.onAppendNote(action.params.text);
      deps.navigationRef.current?.navigate('Notes');
      return;
    }
    case 'set_settings_hint': {
      deps.onSettingsHint(action.params.message);
      return;
    }
    default:
      return;
  }
}
