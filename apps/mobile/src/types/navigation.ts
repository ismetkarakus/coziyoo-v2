export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  ProductDetail: { productId: string };
  OrderStatus: undefined;
  Settings: undefined;
  Profile: { userId?: string } | undefined;
  Notes: { prefill?: string } | undefined;
};
