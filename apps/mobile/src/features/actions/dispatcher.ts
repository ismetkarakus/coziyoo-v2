import type { NavigationContainerRef } from '@react-navigation/native';
import type { RefObject } from 'react';
import type { RootStackParamList } from '../../types/navigation';
import type { ValidAgentActionEnvelope } from './schema';

type DispatcherDependencies = {
  navigationRef: RefObject<NavigationContainerRef<RootStackParamList>>;
  onAppendNote: (text: string) => void;
  onSettingsHint: (message: string) => void;
};

export function dispatchAgentAction(message: ValidAgentActionEnvelope, deps: DispatcherDependencies) {
  const action = message.action;

  switch (action.name) {
    case 'navigate': {
      if (action.params.screen === 'Notes') {
        deps.navigationRef.current?.navigate('Notes', {
          prefill: action.params.prefill,
        });
      } else if (action.params.screen === 'Profile') {
        deps.navigationRef.current?.navigate('Profile');
      } else if (action.params.screen === 'Settings') {
        deps.navigationRef.current?.navigate('Settings');
      } else {
        deps.navigationRef.current?.navigate('Home');
      }
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
