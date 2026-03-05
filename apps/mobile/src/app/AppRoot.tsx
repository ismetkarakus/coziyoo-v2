import React, { useCallback, useEffect } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FloatingAvatar } from '../components/FloatingAvatar';
import { useAvatarSessionController } from '../domains/voice/useAvatarSessionController';
import { useScreenContextStore } from '../domains/voice/screenContextStore';
import { LoginScreen } from '../features/auth/LoginScreen';
import { HomeScreen } from '../features/home/HomeScreen';
import { OrderStatusScreen } from '../features/orders/OrderStatusScreen';
import { ProductDetailScreen } from '../features/product/ProductDetailScreen';
import { loadStoredAuth } from '../services/storage/authStorage';
import { useSessionStore } from '../state/sessionStore';
import type { RootStackParamList } from '../types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function AppRoot() {
  const auth = useSessionStore((s) => s.auth);
  const hydrated = useSessionStore((s) => s.hydrated);
  const setAuth = useSessionStore((s) => s.setAuth);
  const setHydrated = useSessionStore((s) => s.setHydrated);
  const setContext = useScreenContextStore((s) => s.setContext);

  const avatar = useAvatarSessionController({ navigationRef });

  useEffect(() => {
    const hydrate = async () => {
      const stored = await loadStoredAuth();
      if (stored) {
        setAuth(stored);
      }
      setHydrated(true);
    };

    void hydrate();
  }, [setAuth, setHydrated]);

  const onNavStateChange = useCallback(() => {
    const route = navigationRef.getCurrentRoute();
    if (!route) return;
    setContext(({
      screenName: route.name,
      routeParams: (route.params ?? {}) as Record<string, unknown>,
      visibleProducts: [],
      selectedProductId: route.name === 'ProductDetail' ? String((route.params as { productId?: string })?.productId ?? '') : undefined,
      sessionCapabilities: {
        canPlaceOrder: true,
        hasAddress: false,
        paymentAvailable: false,
      },
    }));
  }, [setContext]);

  if (!hydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <NavigationContainer ref={navigationRef} onStateChange={onNavStateChange}>
        <Stack.Navigator>
          {!auth ? (
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          ) : (
            <>
              <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Dishes' }} />
              <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title: 'Dish Details' }} />
              <Stack.Screen name="OrderStatus" component={OrderStatusScreen} options={{ title: 'Order Status' }} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>

      {auth ? (
        <>
          <FloatingAvatar
            state={avatar.uiState}
            unreadSuggestion={avatar.unreadSuggestion}
            onPress={() => {
              avatar.markAvatarSeen();
              if (avatar.isConnected) {
                void avatar.stop();
              } else {
                void avatar.start();
              }
            }}
          />
          {avatar.lastAssistantText ? (
            <TouchableOpacity
              style={styles.assistantBanner}
              onPress={() => Alert.alert('Assistant', avatar.lastAssistantText)}
            >
              <Text numberOfLines={2} style={styles.assistantText}>
                {avatar.lastAssistantText}
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  assistantBanner: {
    position: 'absolute',
    right: 92,
    bottom: 32,
    maxWidth: 220,
    borderRadius: 12,
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  assistantText: {
    color: '#E2E8F0',
    fontSize: 12,
  },
});
