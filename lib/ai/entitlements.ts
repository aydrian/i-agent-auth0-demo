type Entitlements = {
  maxMessagesPerHour: number;
};

export const entitlementsByUserType = {
  authenticated: {
    maxMessagesPerHour: 10,
  },
} as const satisfies Record<string, Entitlements>;
