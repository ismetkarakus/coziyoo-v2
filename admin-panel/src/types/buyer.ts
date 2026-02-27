export type BuyerDetail = {
  id: string;
  email: string;
  displayName: string;
  fullName: string | null;
  role: "buyer" | "seller" | "both";
  status: "active" | "disabled";
  countryCode: string | null;
  language: string | null;
  createdAt: string;
  updatedAt: string;
  profileImageUrl?: string | null;
};

export type BuyerOrderItem = {
  orderItemId: string;
  foodId: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  unitPrice?: number;
  lineTotal: number;
};

export type BuyerOrderRow = {
  orderId: string;
  orderNo: string;
  status: string;
  totalAmount: number;
  paymentCompleted: boolean;
  paymentStatus: string;
  paymentProvider: string | null;
  paymentUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: BuyerOrderItem[];
};

export type BuyerReviewRow = {
  id: string;
  orderId: string;
  foodId: string;
  foodName: string;
  foodImageUrl: string | null;
  rating: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BuyerCancellationRow = {
  orderId: string;
  orderNo: string;
  totalAmount: number;
  cancelledAt: string;
  reason: string | null;
  items: BuyerOrderItem[];
};

export type BuyerContactInfo = {
  identity: {
    id: string;
    email: string;
    displayName: string;
    fullName: string | null;
    profileImageUrl: string | null;
    status: "active" | "disabled";
    createdAt: string;
    updatedAt: string;
    lastLoginAt: string | null;
  };
  contact: {
    phone: string | null;
    countryCode: string | null;
    language: string | null;
  };
  addresses: {
    home: { id: string; title: string; addressLine: string } | null;
    office: { id: string; title: string; addressLine: string } | null;
    other: Array<{ id: string; title: string; addressLine: string }>;
  };
};

export type BuyerLoginLocation = {
  id: string;
  sessionId: string | null;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  source: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

export type BuyerPagination = {
  mode: "offset";
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type BuyerSummaryMetrics = {
  complaintTotal: number;
  complaintResolved: number;
  complaintUnresolved: number;
  totalSpent: number;
  totalOrders: number;
  monthlyOrderCountCurrent: number;
  monthlyOrderCountPrevious: number;
  monthlySpentCurrent: number;
  monthlySpentPrevious: number;
};
