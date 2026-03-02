export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Settings: undefined;
  Profile: { userId?: string } | undefined;
  Notes: { prefill?: string } | undefined;
};
