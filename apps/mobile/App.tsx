import React, { useState, useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import OnboardingScreen from './src/screens/OnboardingScreen';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ProfileEditScreen from './src/screens/ProfileEditScreen';
import AddressScreen from './src/screens/AddressScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import OrderDetailScreen from './src/screens/OrderDetailScreen';
import FoodDetailScreen, { type FoodItem } from './src/screens/FoodDetailScreen';
import PaymentScreen from './src/screens/PaymentScreen';
import AllergenDisclosureScreen from './src/screens/AllergenDisclosureScreen';
import DeliveryPinScreen from './src/screens/DeliveryPinScreen';
import ReviewScreen from './src/screens/ReviewScreen';
import ComplaintScreen from './src/screens/ComplaintScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import ChatListScreen from './src/screens/ChatListScreen';
import ChatScreen from './src/screens/ChatScreen';
import FavoritesScreen from './src/screens/FavoritesScreen';
import { loadAuthSession, clearAuthSession, type AuthSession } from './src/utils/auth';
import { loadSettings } from './src/utils/settings';
import { theme } from './src/theme/colors';

type NotificationSubscription = { remove: () => void };

type NotificationsModule = {
  setNotificationHandler: (handler: {
    handleNotification: () => Promise<{
      shouldShowAlert: boolean;
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
      shouldShowBanner: boolean;
      shouldShowList: boolean;
    }>;
  }) => void;
  getPermissionsAsync: () => Promise<{ status: string }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getExpoPushTokenAsync: () => Promise<{ data: string }>;
  addNotificationResponseReceivedListener: (
    listener: (response: { notification: { request: { content: { data: Record<string, unknown> } } } }) => void,
  ) => NotificationSubscription;
};

let Notifications: NotificationsModule | null = null;
try {
  Notifications = require('expo-notifications') as NotificationsModule;
} catch {
  Notifications = null;
}

if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function registerPushToken(auth: AuthSession, apiUrl: string) {
  if (!Notifications) return;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    const { status } = existing === 'granted'
      ? { status: existing }
      : await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';

    await fetch(`${apiUrl}/v1/notifications/device-token`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ token, platform }),
    });
  } catch {
    // Push registration is best-effort; never block the user
  }
}

type Screen =
  | 'loading' | 'onboarding' | 'login' | 'home'
  | 'settings' | 'profileEdit' | 'addresses'
  | 'orders' | 'orderDetail' | 'complaintOrders'
  | 'foodDetail' | 'payment'
  | 'allergenDisclosure' | 'deliveryPin'
  | 'review' | 'complaint'
  | 'notifications' | 'favorites'
  | 'chatList' | 'chat';

type TabKey = 'home' | 'messages' | 'cart' | 'notifications' | 'profile';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [homeTab, setHomeTab] = useState<TabKey>('home');
  const [auth, setAuth] = useState<AuthSession | null>(null);

  // Screen params
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [selectedChatName, setSelectedChatName] = useState('');
  const [complaintBackTarget, setComplaintBackTarget] = useState<'orderDetail' | 'complaintOrders'>('orderDetail');

  const [isNewRegistration, setIsNewRegistration] = useState(false);
  const responseListener = useRef<NotificationSubscription | null>(null);

  useEffect(() => {
    loadAuthSession().then((stored) => {
      if (stored) {
        setAuth(stored);
        setScreen('home');
      } else {
        setScreen('onboarding');
      }
    });
  }, []);

  // Register push token and notification listeners when auth is set
  useEffect(() => {
    if (!auth) return;
    if (!Notifications) return;

    loadSettings().then((s) => {
      void registerPushToken(auth, s.apiUrl);
    });

    // Navigate to order detail when notification is tapped
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      const orderId = data?.orderId as string | undefined;
      if (orderId) {
        setSelectedOrderId(orderId);
        setScreen('orderDetail');
      }
    });

    return () => { responseListener.current?.remove(); };
  }, [auth]);

  function handleLogin(session: AuthSession) {
    setAuth(session);
    setScreen('home');
  }

  function handleOnboardingComplete(session: AuthSession) {
    setAuth(session);
    setIsNewRegistration(true);
    setScreen('profileEdit');
  }

  async function handleLogout() {
    setScreen('login');
    setAuth(null);
    await clearAuthSession();
  }

  function goHome(tab: TabKey = 'home') {
    setHomeTab(tab);
    setScreen('home');
  }

  if (screen === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }

  if (screen === 'onboarding' && !auth) {
    return (
      <OnboardingScreen
        onComplete={handleOnboardingComplete}
        onGoToLogin={() => setScreen('login')}
      />
    );
  }

  if (screen === 'login' || !auth) {
    return <LoginScreen onLogin={handleLogin} onGoToRegister={() => setScreen('onboarding')} />;
  }

  if (screen === 'settings') {
    return (
      <SettingsScreen
        auth={auth}
        onBack={() => goHome('profile')}
        onOpenComplaintOrders={() => setScreen('complaintOrders')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'profileEdit') {
    return (
      <ProfileEditScreen
        auth={auth}
        isNewRegistration={isNewRegistration}
        onBack={() => {
          if (isNewRegistration) {
            setIsNewRegistration(false);
            goHome('home');
          } else {
            goHome('profile');
          }
        }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'addresses') {
    return (
      <AddressScreen
        auth={auth}
        onBack={() => goHome('profile')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'orders') {
    return (
      <OrdersScreen
        auth={auth}
        onBack={() => goHome('profile')}
        onOpenOrderDetail={(id) => { setSelectedOrderId(id); setScreen('orderDetail'); }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'complaintOrders') {
    return (
      <OrdersScreen
        auth={auth}
        title="Şikayet Oluştur"
        emptyTitle="Şikayet için sipariş bulunamadı"
        emptySubtitle="Siparişlerin tamamlandığında buradan şikayet oluşturabilirsin."
        onBack={() => setScreen('settings')}
        onOpenOrderDetail={(id) => {
          setSelectedOrderId(id);
          setComplaintBackTarget('complaintOrders');
          setScreen('complaint');
        }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'orderDetail' && selectedOrderId) {
    return (
      <OrderDetailScreen
        auth={auth}
        orderId={selectedOrderId}
        onBack={() => setScreen('orders')}
        onOpenPayment={(id) => { setSelectedOrderId(id); setScreen('payment'); }}
        onOpenReview={(id) => { setSelectedOrderId(id); setScreen('review'); }}
        onOpenComplaint={(id) => {
          setSelectedOrderId(id);
          setComplaintBackTarget('orderDetail');
          setScreen('complaint');
        }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'foodDetail' && selectedFood) {
    return (
      <FoodDetailScreen
        food={selectedFood}
        onBack={() => goHome('home')}
        onAddToCart={(_food: FoodItem, _quantity: number) => goHome('cart')}
        onOpenSeller={() => goHome('home')}
      />
    );
  }

  if (screen === 'payment' && selectedOrderId) {
    return (
      <PaymentScreen
        auth={auth}
        orderId={selectedOrderId}
        onBack={() => { setScreen('orderDetail'); }}
        onPaymentComplete={() => { setScreen('orderDetail'); }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'allergenDisclosure' && selectedOrderId) {
    return (
      <AllergenDisclosureScreen
        auth={auth}
        orderId={selectedOrderId}
        onBack={() => setScreen('orderDetail')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'deliveryPin' && selectedOrderId) {
    return (
      <DeliveryPinScreen
        auth={auth}
        orderId={selectedOrderId}
        onBack={() => setScreen('orderDetail')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'review' && selectedOrderId) {
    return (
      <ReviewScreen
        auth={auth}
        orderId={selectedOrderId}
        onBack={() => setScreen('orderDetail')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'complaint' && selectedOrderId) {
    return (
      <ComplaintScreen
        auth={auth}
        orderId={selectedOrderId}
        onBack={() => setScreen(complaintBackTarget)}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'notifications') {
    return (
      <NotificationsScreen
        auth={auth}
        onBack={() => goHome('notifications')}
        onOpenOrderDetail={(id) => { setSelectedOrderId(id); setScreen('orderDetail'); }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'chatList') {
    return (
      <ChatListScreen
        auth={auth}
        onBack={() => goHome('messages')}
        onOpenChat={(chatId, name) => { setSelectedChatId(chatId); setSelectedChatName(name); setScreen('chat'); }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'chat' && selectedChatId) {
    return (
      <ChatScreen
        auth={auth}
        chatId={selectedChatId}
        sellerName={selectedChatName}
        onBack={() => setScreen('chatList')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'favorites') {
    return (
      <FavoritesScreen
        auth={auth}
        onBack={() => goHome('profile')}
        onAuthRefresh={setAuth}
      />
    );
  }

  return (
    <HomeScreen
      auth={auth}
      initialTab={homeTab}
      onOpenSettings={() => setScreen('settings')}
      onOpenOrders={() => setScreen('orders')}
      onOpenNotifications={() => setScreen('notifications')}
      onOpenChatList={() => setScreen('chatList')}
      onOpenFavorites={() => setScreen('favorites')}
      onOpenFoodDetail={(food: FoodItem) => { setSelectedFood(food); setScreen('foodDetail'); }}
      onLogout={handleLogout}
      onAuthRefresh={setAuth}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: theme.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
