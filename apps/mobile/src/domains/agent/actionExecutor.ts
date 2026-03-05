import type { NavigationContainerRef } from '@react-navigation/native';
import { useOrderStore } from '../orders/orderStore';
import type { RootStackParamList } from '../../types/navigation';
import type { AgentAction } from './types';

type ExecuteDeps = {
  navigationRef: { current: NavigationContainerRef<RootStackParamList> | null };
};

export function executeAgentAction(action: AgentAction, deps: ExecuteDeps) {
  const orderState = useOrderStore.getState();

  switch (action.type) {
    case 'navigate':
      if (action.screen === 'ProductDetail') {
        deps.navigationRef.current?.navigate('ProductDetail', {
          productId: String(action.params?.productId ?? ''),
        });
      } else if (action.screen === 'OrderStatus') {
        deps.navigationRef.current?.navigate('OrderStatus');
      } else {
        deps.navigationRef.current?.navigate('Home');
      }
      break;
    case 'highlight_product':
      useOrderStore.getState().setHighlightedProductId(action.productId);
      break;
    case 'add_item':
      orderState.addItem(action.productId, action.quantity);
      break;
    case 'remove_item':
      orderState.removeItem(action.productId);
      break;
    case 'set_quantity':
      orderState.setQuantity(action.productId, action.quantity);
      break;
    case 'place_order':
      orderState.placeOrder();
      deps.navigationRef.current?.navigate('OrderStatus');
      break;
    case 'track_order':
      deps.navigationRef.current?.navigate('OrderStatus');
      break;
    default:
      break;
  }
}
