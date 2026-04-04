import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
  TouchableOpacity,
  Animated,
  PanResponder,
  BackHandler,
  KeyboardAvoidingView,
} from 'react-native';
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
import TicketListScreen from './src/screens/TicketListScreen';
import TicketDetailScreen from './src/screens/TicketDetailScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import ChatListScreen from './src/screens/ChatListScreen';
import ChatScreen from './src/screens/ChatScreen';
import FavoritesScreen from './src/screens/FavoritesScreen';
import SellerHomeScreen from './src/screens/SellerHomeScreen';
import SellerProfileDetailScreen from './src/screens/SellerProfileDetailScreen';
import SellerProfileScreen from './src/screens/SellerProfileScreen';
import SellerFoodsScreen from './src/screens/SellerFoodsScreen';
import SellerFoodsManagerScreen from './src/screens/SellerFoodsManagerScreen';
import SellerLotsScreen from './src/screens/SellerLotsScreen';
import SellerOrdersScreen from './src/screens/SellerOrdersScreen';
import SellerOrderDetailScreen from './src/screens/SellerOrderDetailScreen';
import SellerComplianceScreen from './src/screens/SellerComplianceScreen';
import SellerFinanceScreen from './src/screens/SellerFinanceScreen';
import SellerReviewsScreen from './src/screens/SellerReviewsScreen';
import { loadAuthSession, clearAuthSession, refreshAuthSession, saveAuthSession, type AuthSession } from './src/utils/auth';
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
  | 'orders' | 'orderDetail' | 'complaintOrders' | 'ticketList' | 'ticketDetail'
  | 'foodDetail' | 'payment'
  | 'allergenDisclosure' | 'deliveryPin'
  | 'review' | 'complaint'
  | 'notifications' | 'favorites'
  | 'sellerProfileDetail' | 'sellerProfile' | 'sellerFoods' | 'sellerFoodsManager' | 'sellerLots' | 'sellerOrders' | 'sellerOrderDetail' | 'sellerCompliance' | 'sellerFinance' | 'sellerReviews'
  | 'chatList' | 'chat';

type TabKey = 'home' | 'messages' | 'cart' | 'notifications' | 'profile';
type OrderDetailBackTarget = 'orders' | 'home';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [homeTab, setHomeTab] = useState<TabKey>('home');
  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [actorMode, setActorMode] = useState<'buyer' | 'seller'>('buyer');

  // Screen params
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderDetailBackTarget, setOrderDetailBackTarget] = useState<OrderDetailBackTarget>('orders');
  const [sellerOrderModalVisible, setSellerOrderModalVisible] = useState(false);
  const sheetTranslateY = useRef(new Animated.Value(0)).current;
  const sheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) {
          sheetTranslateY.setValue(gesture.dy);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 120 || gesture.vy > 0.5) {
          closeSheet();
        } else {
          Animated.spring(sheetTranslateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
        }
      },
    }),
  ).current;
  function closeSheet() {
    Animated.timing(sheetTranslateY, {
      toValue: 600,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      sheetTranslateY.setValue(0);
      setSellerOrderModalVisible(false);
    });
  }
  useEffect(() => {
    if (sellerOrderModalVisible) {
      sheetTranslateY.setValue(600);
      Animated.spring(sheetTranslateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }).start();
    }
  }, [sellerOrderModalVisible]);
  useEffect(() => {
    if (!sellerOrderModalVisible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeSheet();
      return true;
    });
    return () => sub.remove();
  }, [sellerOrderModalVisible]);
  const [sellerFoodsInitialEditId, setSellerFoodsInitialEditId] = useState<string | null>(null);
  const [sellerFoodsInitialEditFood, setSellerFoodsInitialEditFood] = useState<any | null>(null);
  const [sellerFoodsFromManager, setSellerFoodsFromManager] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
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
        setActorMode(stored.userType === 'seller' ? 'seller' : 'buyer');
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
        setOrderDetailBackTarget('home');
        setScreen('orderDetail');
      }
    });

    return () => { responseListener.current?.remove(); };
  }, [auth]);

  function handleLogin(session: AuthSession) {
    setAuth(session);
    setActorMode(session.userType === 'seller' ? 'seller' : 'buyer');
    setScreen('home');
  }

  function handleOnboardingComplete(session: AuthSession) {
    setAuth(session);
    setActorMode(session.userType === 'seller' ? 'seller' : 'buyer');
    setIsNewRegistration(false);
    setScreen('home');
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

  async function enableSellerModeAndOpen() {
    try {
      const session = auth;
      if (!session) {
        Alert.alert('Oturum', 'Önce giriş yapmalısın.');
        return;
      }

      if (session.userType === 'seller' || session.userType === 'both') {
        setActorMode('seller');
        setScreen('home');
        return;
      }

      const { apiUrl } = await loadSettings();
      let currentSession: AuthSession = session;
      let response = await fetch(`${apiUrl}/v1/auth/me/enable-seller`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentSession.accessToken}`,
        },
      });

      if (response.status === 401) {
        const refreshed = await refreshAuthSession(apiUrl, currentSession);
        if (!refreshed) {
          Alert.alert('Oturum', 'Oturumun yenilenemedi. Lütfen tekrar giriş yap.');
          return;
        }
        currentSession = refreshed;
        setAuth(refreshed);
        response = await fetch(`${apiUrl}/v1/auth/me/enable-seller`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${currentSession.accessToken}`,
          },
        });
      }

      const payload = await response.json().catch(() => ({} as { error?: { message?: string }; data?: { user?: { userType?: string }; tokens?: { accessToken?: string } } }));
      if (!response.ok) {
        Alert.alert('Hata', payload?.error?.message ?? 'Satıcı modu açılamadı.');
        return;
      }

      const nextUserType = payload?.data?.user?.userType ?? 'both';
      const nextAccessToken = payload?.data?.tokens?.accessToken ?? currentSession.accessToken;
      const nextSession: AuthSession = {
        ...currentSession,
        accessToken: nextAccessToken,
        userType: nextUserType,
      };
      await saveAuthSession(nextSession);
      setAuth(nextSession);
      setActorMode('seller');
      setScreen('home');
    } catch (error) {
      Alert.alert('Hata', error instanceof Error ? error.message : 'Satıcı modu açılamadı.');
    }
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
        onOpenComplaintOrders={() => setScreen('ticketList')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'ticketList') {
    return (
      <TicketListScreen
        auth={auth}
        onBack={() => setScreen('settings')}
        onCreateTicket={() => setScreen('complaintOrders')}
        onOpenTicket={(ticketId) => {
          setSelectedTicketId(ticketId);
          setScreen('ticketDetail');
        }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'ticketDetail' && selectedTicketId) {
    return (
      <TicketDetailScreen
        auth={auth}
        ticketId={selectedTicketId}
        onBack={() => setScreen('ticketList')}
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
        onBack={() => {
          if (actorMode === 'seller') setScreen('sellerProfileDetail');
          else goHome('profile');
        }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'orders') {
    return (
      <OrdersScreen
        auth={auth}
        onBack={() => goHome('profile')}
        onOpenOrderDetail={(id) => {
          setSelectedOrderId(id);
          setOrderDetailBackTarget('orders');
          setScreen('orderDetail');
        }}
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
        onBack={() => {
          if (orderDetailBackTarget === 'home') goHome('home');
          else setScreen('orders');
        }}
        onOpenPayment={(id) => { setSelectedOrderId(id); setScreen('payment'); }}
        onOpenDeliveryPin={(id) => { setSelectedOrderId(id); setScreen('deliveryPin'); }}
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
        onCreated={(ticket) => {
          setSelectedTicketId(ticket.id);
          setScreen('ticketDetail');
        }}
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
        onOpenOrderDetail={(id) => {
          setSelectedOrderId(id);
          setOrderDetailBackTarget('home');
          setScreen('orderDetail');
        }}
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

  if (screen === 'sellerProfileDetail') {
    return (
      <SellerProfileDetailScreen
        auth={auth}
        onBack={() => setScreen('home')}
        onEdit={() => setScreen('sellerProfile')}
        onOpenOrderHistory={() => setScreen('sellerOrders')}
        onOpenCompliance={() => setScreen('sellerCompliance')}
        onOpenFinance={() => setScreen('sellerFinance')}
        onOpenReviews={() => setScreen('sellerReviews')}
        onOpenSettings={() => setScreen('settings')}
        onLogout={handleLogout}
        onOpenAddresses={() => setScreen('addresses')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerProfile') {
    return (
      <SellerProfileScreen
        auth={auth}
        onBack={() => setScreen('sellerProfileDetail')}
        onOpenAddresses={() => setScreen('addresses')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerFoods') {
    return (
      <SellerFoodsScreen
        auth={auth}
        initialEditFoodId={sellerFoodsInitialEditId}
        initialEditFood={sellerFoodsInitialEditFood}
        onBack={() => setScreen(sellerFoodsFromManager ? 'sellerFoodsManager' : 'home')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerFoodsManager') {
    return (
      <SellerFoodsManagerScreen
        auth={auth}
        onBack={() => setScreen('home')}
        onOpenFoodsForm={(mode, foodId, food) => {
          setSellerFoodsFromManager(true);
          setSellerFoodsInitialEditId(mode === 'edit' ? (foodId ?? null) : null);
          setSellerFoodsInitialEditFood(mode === 'edit' ? (food ?? null) : null);
          setScreen('sellerFoods');
        }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerLots') {
    return (
      <SellerLotsScreen
        auth={auth}
        onBack={() => setScreen('home')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerOrders') {
    return (
      <SellerOrdersScreen
        auth={auth}
        onBack={() => setScreen('sellerProfileDetail')}
        onOpenOrder={(id) => { setSelectedOrderId(id); setScreen('sellerOrderDetail'); }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerOrderDetail' && selectedOrderId) {
    return (
      <SellerOrderDetailScreen
        auth={auth}
        orderId={selectedOrderId}
        onBack={() => setScreen('sellerOrders')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerCompliance') {
    return (
      <SellerComplianceScreen
        auth={auth}
        onBack={() => setScreen('home')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerFinance') {
    return (
      <SellerFinanceScreen
        auth={auth}
        onBack={() => setScreen('home')}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'sellerReviews') {
    return (
      <SellerReviewsScreen
        auth={auth}
        onBack={() => setScreen('sellerProfileDetail')}
        onAuthRefresh={setAuth}
      />
    );
  }

  const canSwitchRole = auth.userType === 'both';
  if (actorMode === 'seller' && screen === 'home') {
    return (
      <>
        <SellerHomeScreen
          auth={auth}
          onOpenProfile={() => setScreen('sellerProfileDetail')}
          onOpenFoodsManager={() => setScreen('sellerFoodsManager')}
          onOpenOrder={(id) => {
            setSelectedOrderId(id);
            sheetTranslateY.setValue(0);
            setSellerOrderModalVisible(true);
          }}
          onAuthRefresh={setAuth}
          onSwitchToBuyer={canSwitchRole ? () => setActorMode('buyer') : undefined}
        />
        {sellerOrderModalVisible && selectedOrderId ? (
          <KeyboardAvoidingView
            style={styles.sheetOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          >
            <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={closeSheet} />
            <Animated.View style={[styles.sheetCard, { transform: [{ translateY: sheetTranslateY }] }]} {...sheetPanResponder.panHandlers}>
              <View style={styles.sheetGrabber} />
              <SellerOrderDetailScreen
                auth={auth}
                orderId={selectedOrderId}
                onBack={closeSheet}
                onAuthRefresh={setAuth}
              />
            </Animated.View>
          </KeyboardAvoidingView>
        ) : null}
      </>
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
      onSwitchToSeller={auth.userType === 'seller' || auth.userType === 'both' || auth.userType === 'buyer'
        ? () => { void enableSellerModeAndOpen(); }
        : undefined}
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
  sheetOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-end',
    zIndex: 999,
  },
  sheetBackdrop: {
    flex: 1,
  },
  sheetCard: {
    height: '88%',
    backgroundColor: '#F7F4EF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
  },
  sheetGrabber: {
    width: 52,
    height: 5,
    borderRadius: 99,
    backgroundColor: '#D2C8BA',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 2,
  },
});
