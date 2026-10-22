// Generated from the former prisma/schema.prisma; now maintained by hand.
// Relation graph at the type level, for include/select result types.

export interface RelationTypes {
  User: {
    accounts: { kind: "many"; model: "Account" };
    sessions: { kind: "many"; model: "Session" };
    wallet: { kind: "one"; model: "Wallet"; nullable: true };
    memberships: { kind: "many"; model: "LoungeMember" };
    bookings: { kind: "many"; model: "Booking" };
    bookingsCreated: { kind: "many"; model: "Booking" };
    extensionsAdded: { kind: "many"; model: "BookingExtension" };
    canteenOrders: { kind: "many"; model: "CanteenOrder" };
    canteenOrdersTaken: { kind: "many"; model: "CanteenOrder" };
    transactions: { kind: "many"; model: "Transaction" };
    transactionsTaken: { kind: "many"; model: "Transaction" };
    ownedOrganizations: { kind: "many"; model: "Organization" };
    auditLogs: { kind: "many"; model: "AuditLog" };
    shiftsOpened: { kind: "many"; model: "Shift" };
    shiftsClosed: { kind: "many"; model: "Shift" };
    expensesRecorded: { kind: "many"; model: "ShiftExpense" };
    expensesVoided: { kind: "many"; model: "ShiftExpense" };
  };
  Account: {
    user: { kind: "one"; model: "User"; nullable: false };
  };
  Session: {
    user: { kind: "one"; model: "User"; nullable: false };
  };
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- no relations
  VerificationToken: {};
  Organization: {
    owner: { kind: "one"; model: "User"; nullable: false };
    lounges: { kind: "many"; model: "Lounge" };
    subscriptions: { kind: "many"; model: "Subscription" };
    payouts: { kind: "many"; model: "Payout" };
  };
  Subscription: {
    organization: { kind: "one"; model: "Organization"; nullable: false };
  };
  Lounge: {
    organization: { kind: "one"; model: "Organization"; nullable: false };
    photos: { kind: "many"; model: "LoungePhoto" };
    openingHours: { kind: "many"; model: "OpeningHours" };
    members: { kind: "many"; model: "LoungeMember" };
    zones: { kind: "many"; model: "FloorZone" };
    categories: { kind: "many"; model: "DeviceCategory" };
    devices: { kind: "many"; model: "Device" };
    pricingRules: { kind: "many"; model: "PricingRule" };
    bookings: { kind: "many"; model: "Booking" };
    menuItems: { kind: "many"; model: "MenuItem" };
    menuCategories: { kind: "many"; model: "MenuCategory" };
    canteenOrders: { kind: "many"; model: "CanteenOrder" };
    transactions: { kind: "many"; model: "Transaction" };
    shifts: { kind: "many"; model: "Shift" };
    shiftExpenses: { kind: "many"; model: "ShiftExpense" };
  };
  LoungePhoto: {
    lounge: { kind: "one"; model: "Lounge"; nullable: false };
  };
  OpeningHours: {
    lounge: { kind: "one"; model: "Lounge"; nullable: false };
  };
  LoungeMember: {
    lounge: { kind: "one"; model: "Lounge"; nullable: false };
    user: { kind: "one"; model: "User"; nullable: false };
  };
  FloorZone: {
    lounge: { kind: "one"; model: "Lounge"; nullable: false };
    devices: { kind: "many"; model: "Device" };
  };
  DeviceCategory: {
    lounge: { kind: "one"; model: "Lounge"; nullable: false };
    devices: { kind: "many"; model: "Device" };
    pricingRules: { kind: "many"; model: "PricingRule" };
  };
  Device: {
    lounge: { kind: "one"; model: "Lounge"; nullable: false };
    category: { kind: "one"; model: "DeviceCategory"; nullable: false };
    zone: { kind: "one"; model: "FloorZone"; nullable: true };
    bookings: { kind: "many"; model: "Booking" };
    segments: { kind: "many"; model: "SessionSegment" };
  };
  PricingRule: {
    lounge: { kind: "one"; model: "Lounge"; nullable: false };
    category: { kind: "one"; model: "DeviceCategory"; nullable: true };
  };
  Booking: {
    lounge: { kind: "one"; model: "Lounge"; nullable: false };
    device: { kind: "one"; model: "Device"; nullable: false };
    customer: { kind: "one"; model: "User"; nullable: true };
    createdBy: { kind: "one"; model: "User"; nullable: true };
    extensions: { kind: "many"; model: "BookingExtension" };
    segments: { kind: "many"; model: "SessionSegment" };
    canteenOrders: { kind: "many"; model: "CanteenOrder" };
    transactions: { kind: "many"; model: "Transaction" };
  };
  BookingExtension: {
    booking: { kind: "one"; model: "Booking"; nullable: false };
    addedBy: { kind: "one"; model: "User"; nullable: true };
  };
  SessionSegment: {
    booking: { kind: "one"; model: "Booking"; nullable: false };
    device: { kind: "one"; model: "Device"; nullable: false };
  };
  MenuCategory: {
    lounge: { kind: "one"; model: "Lounge"; nullable: false };
    items: { kind: "many"; model: "MenuItem" };
  };
  MenuItem: {
    lounge: { kind: "one"; model: "Lounge"; nullable: false };
    menuCategory: { kind: "one"; model: "MenuCategory"; nullable: false };
    orderItems: { kind: "many"; model: "CanteenOrderItem" };
  };
  CanteenOrder: {
    lounge: { kind: "one"; model: "Lounge"; nullable: false };
    booking: { kind: "one"; model: "Booking"; nullable: true };
    customer: { kind: "one"; model: "User"; nullable: true };
    createdBy: { kind: "one"; model: "User"; nullable: true };
    items: { kind: "many"; model: "CanteenOrderItem" };
    transactions: { kind: "many"; model: "Transaction" };
  };
  CanteenOrderItem: {
    order: { kind: "one"; model: "CanteenOrder"; nullable: false };
    menuItem: { kind: "one"; model: "MenuItem"; nullable: false };
  };
  Wallet: {
    user: { kind: "one"; model: "User"; nullable: false };
  };
  Transaction: {
    lounge: { kind: "one"; model: "Lounge"; nullable: true };
    booking: { kind: "one"; model: "Booking"; nullable: true };
    canteenOrder: { kind: "one"; model: "CanteenOrder"; nullable: true };
    payout: { kind: "one"; model: "Payout"; nullable: true };
    shift: { kind: "one"; model: "Shift"; nullable: true };
    user: { kind: "one"; model: "User"; nullable: true };
    processedBy: { kind: "one"; model: "User"; nullable: true };
  };
  Shift: {
    lounge: { kind: "one"; model: "Lounge"; nullable: false };
    cashier: { kind: "one"; model: "User"; nullable: false };
    closedBy: { kind: "one"; model: "User"; nullable: true };
    transactions: { kind: "many"; model: "Transaction" };
    expenses: { kind: "many"; model: "ShiftExpense" };
  };
  ShiftExpense: {
    shift: { kind: "one"; model: "Shift"; nullable: false };
    lounge: { kind: "one"; model: "Lounge"; nullable: false };
    createdBy: { kind: "one"; model: "User"; nullable: false };
    voidedBy: { kind: "one"; model: "User"; nullable: true };
  };
  Payout: {
    organization: { kind: "one"; model: "Organization"; nullable: false };
    transactions: { kind: "many"; model: "Transaction" };
  };
  AuditLog: {
    actor: { kind: "one"; model: "User"; nullable: true };
  };
}
