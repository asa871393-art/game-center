// Generated from the former prisma/schema.prisma; now maintained by hand.
// Field kinds, defaults, relations and unique keys the data layer enforces.

import type { ModelMeta } from "./meta-types";
import type { ModelName } from "@/lib/db/types";

export const MODELS: Record<ModelName, ModelMeta> = {
  "User": {
    "collection": "users",
    "scalars": {
      "id": {
        "type": "String"
      },
      "name": {
        "type": "String",
        "optional": true
      },
      "email": {
        "type": "String",
        "optional": true
      },
      "emailVerified": {
        "type": "DateTime",
        "optional": true
      },
      "phone": {
        "type": "String",
        "optional": true
      },
      "image": {
        "type": "String",
        "optional": true
      },
      "passwordHash": {
        "type": "String",
        "optional": true
      },
      "pinHash": {
        "type": "String",
        "optional": true
      },
      "pinFailedAttempts": {
        "type": "Int",
        "default": {
          "value": 0
        }
      },
      "pinLockedUntil": {
        "type": "DateTime",
        "optional": true
      },
      "role": {
        "type": "Enum",
        "default": {
          "value": "CUSTOMER"
        }
      },
      "isActive": {
        "type": "Boolean",
        "default": {
          "value": true
        }
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "accounts": {
        "kind": "many",
        "model": "Account",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "sessions": {
        "kind": "many",
        "model": "Session",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "wallet": {
        "kind": "oneBack",
        "model": "Wallet",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "memberships": {
        "kind": "many",
        "model": "LoungeMember",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "bookings": {
        "kind": "many",
        "model": "Booking",
        "fk": "customerId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "bookingsCreated": {
        "kind": "many",
        "model": "Booking",
        "fk": "createdById",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "extensionsAdded": {
        "kind": "many",
        "model": "BookingExtension",
        "fk": "addedById",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "canteenOrders": {
        "kind": "many",
        "model": "CanteenOrder",
        "fk": "customerId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "canteenOrdersTaken": {
        "kind": "many",
        "model": "CanteenOrder",
        "fk": "createdById",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "transactions": {
        "kind": "many",
        "model": "Transaction",
        "fk": "userId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "transactionsTaken": {
        "kind": "many",
        "model": "Transaction",
        "fk": "processedById",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "ownedOrganizations": {
        "kind": "many",
        "model": "Organization",
        "fk": "ownerId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "auditLogs": {
        "kind": "many",
        "model": "AuditLog",
        "fk": "actorId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "shiftsOpened": {
        "kind": "many",
        "model": "Shift",
        "fk": "cashierId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "shiftsClosed": {
        "kind": "many",
        "model": "Shift",
        "fk": "closedById",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "expensesRecorded": {
        "kind": "many",
        "model": "ShiftExpense",
        "fk": "createdById",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "expensesVoided": {
        "kind": "many",
        "model": "ShiftExpense",
        "fk": "voidedById",
        "ref": "id",
        "onDelete": "SetNull"
      }
    },
    "uniques": [
      [
        "email"
      ],
      [
        "phone"
      ]
    ]
  },
  "Account": {
    "collection": "accounts",
    "compoundId": [
      "provider",
      "providerAccountId"
    ],
    "scalars": {
      "userId": {
        "type": "String"
      },
      "type": {
        "type": "String"
      },
      "provider": {
        "type": "String"
      },
      "providerAccountId": {
        "type": "String"
      },
      "refresh_token": {
        "type": "String",
        "optional": true
      },
      "access_token": {
        "type": "String",
        "optional": true
      },
      "expires_at": {
        "type": "Int",
        "optional": true
      },
      "token_type": {
        "type": "String",
        "optional": true
      },
      "scope": {
        "type": "String",
        "optional": true
      },
      "id_token": {
        "type": "String",
        "optional": true
      },
      "session_state": {
        "type": "String",
        "optional": true
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "user": {
        "kind": "one",
        "model": "User",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    },
    "uniques": []
  },
  "Session": {
    "collection": "authSessions",
    "scalars": {
      "sessionToken": {
        "type": "String"
      },
      "userId": {
        "type": "String"
      },
      "expires": {
        "type": "DateTime"
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "user": {
        "kind": "one",
        "model": "User",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    },
    "uniques": [
      [
        "sessionToken"
      ]
    ]
  },
  "VerificationToken": {
    "collection": "verificationTokens",
    "compoundId": [
      "identifier",
      "token"
    ],
    "scalars": {
      "identifier": {
        "type": "String"
      },
      "token": {
        "type": "String"
      },
      "expires": {
        "type": "DateTime"
      }
    },
    "relations": {},
    "uniques": []
  },
  "Organization": {
    "collection": "organizations",
    "scalars": {
      "id": {
        "type": "String"
      },
      "name": {
        "type": "String"
      },
      "slug": {
        "type": "String"
      },
      "status": {
        "type": "Enum",
        "default": {
          "value": "ACTIVE"
        }
      },
      "ownerId": {
        "type": "String"
      },
      "commissionRateBps": {
        "type": "Int",
        "default": {
          "value": 1000
        }
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "owner": {
        "kind": "one",
        "model": "User",
        "fk": "ownerId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "lounges": {
        "kind": "many",
        "model": "Lounge",
        "fk": "organizationId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "subscriptions": {
        "kind": "many",
        "model": "Subscription",
        "fk": "organizationId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "payouts": {
        "kind": "many",
        "model": "Payout",
        "fk": "organizationId",
        "ref": "id",
        "onDelete": "Restrict"
      }
    },
    "uniques": [
      [
        "slug"
      ]
    ]
  },
  "Subscription": {
    "collection": "subscriptions",
    "scalars": {
      "id": {
        "type": "String"
      },
      "organizationId": {
        "type": "String"
      },
      "plan": {
        "type": "Enum"
      },
      "status": {
        "type": "Enum",
        "default": {
          "value": "TRIALING"
        }
      },
      "priceMonthly": {
        "type": "Decimal"
      },
      "currency": {
        "type": "String",
        "default": {
          "value": "USD"
        }
      },
      "maxLounges": {
        "type": "Int",
        "default": {
          "value": 1
        }
      },
      "maxDevices": {
        "type": "Int",
        "default": {
          "value": 20
        }
      },
      "currentPeriodStart": {
        "type": "DateTime"
      },
      "currentPeriodEnd": {
        "type": "DateTime"
      },
      "cancelAt": {
        "type": "DateTime",
        "optional": true
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "organization": {
        "kind": "one",
        "model": "Organization",
        "fk": "organizationId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    },
    "uniques": []
  },
  "Lounge": {
    "collection": "lounges",
    "scalars": {
      "id": {
        "type": "String"
      },
      "organizationId": {
        "type": "String"
      },
      "name": {
        "type": "String"
      },
      "slug": {
        "type": "String"
      },
      "description": {
        "type": "String",
        "optional": true
      },
      "status": {
        "type": "Enum",
        "default": {
          "value": "DRAFT"
        }
      },
      "addressLine": {
        "type": "String"
      },
      "city": {
        "type": "String"
      },
      "region": {
        "type": "String",
        "optional": true
      },
      "country": {
        "type": "String"
      },
      "postalCode": {
        "type": "String",
        "optional": true
      },
      "latitude": {
        "type": "Float"
      },
      "longitude": {
        "type": "Float"
      },
      "timezone": {
        "type": "String"
      },
      "phone": {
        "type": "String",
        "optional": true
      },
      "email": {
        "type": "String",
        "optional": true
      },
      "currency": {
        "type": "String",
        "default": {
          "value": "IQD"
        }
      },
      "taxRateBps": {
        "type": "Int",
        "default": {
          "value": 0
        }
      },
      "coverImageUrl": {
        "type": "String",
        "optional": true
      },
      "floorPlanWidth": {
        "type": "Int",
        "default": {
          "value": 24
        }
      },
      "floorPlanHeight": {
        "type": "Int",
        "default": {
          "value": 16
        }
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "organization": {
        "kind": "one",
        "model": "Organization",
        "fk": "organizationId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "photos": {
        "kind": "many",
        "model": "LoungePhoto",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "openingHours": {
        "kind": "many",
        "model": "OpeningHours",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "members": {
        "kind": "many",
        "model": "LoungeMember",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "zones": {
        "kind": "many",
        "model": "FloorZone",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "categories": {
        "kind": "many",
        "model": "DeviceCategory",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "devices": {
        "kind": "many",
        "model": "Device",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "pricingRules": {
        "kind": "many",
        "model": "PricingRule",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "bookings": {
        "kind": "many",
        "model": "Booking",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "menuItems": {
        "kind": "many",
        "model": "MenuItem",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "menuCategories": {
        "kind": "many",
        "model": "MenuCategory",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "canteenOrders": {
        "kind": "many",
        "model": "CanteenOrder",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "transactions": {
        "kind": "many",
        "model": "Transaction",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "shifts": {
        "kind": "many",
        "model": "Shift",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "shiftExpenses": {
        "kind": "many",
        "model": "ShiftExpense",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    },
    "uniques": [
      [
        "slug"
      ]
    ]
  },
  "LoungePhoto": {
    "collection": "loungePhotos",
    "scalars": {
      "id": {
        "type": "String"
      },
      "loungeId": {
        "type": "String"
      },
      "url": {
        "type": "String"
      },
      "alt": {
        "type": "String",
        "optional": true
      },
      "sortOrder": {
        "type": "Int",
        "default": {
          "value": 0
        }
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      }
    },
    "relations": {
      "lounge": {
        "kind": "one",
        "model": "Lounge",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    },
    "uniques": []
  },
  "OpeningHours": {
    "collection": "openingHours",
    "scalars": {
      "id": {
        "type": "String"
      },
      "loungeId": {
        "type": "String"
      },
      "dayOfWeek": {
        "type": "Int"
      },
      "opensAtMinute": {
        "type": "Int"
      },
      "closesAtMinute": {
        "type": "Int"
      },
      "isClosed": {
        "type": "Boolean",
        "default": {
          "value": false
        }
      }
    },
    "relations": {
      "lounge": {
        "kind": "one",
        "model": "Lounge",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    },
    "uniques": [
      [
        "loungeId",
        "dayOfWeek"
      ]
    ]
  },
  "LoungeMember": {
    "collection": "loungeMembers",
    "scalars": {
      "id": {
        "type": "String"
      },
      "loungeId": {
        "type": "String"
      },
      "userId": {
        "type": "String"
      },
      "role": {
        "type": "Enum",
        "default": {
          "value": "STAFF"
        }
      },
      "isActive": {
        "type": "Boolean",
        "default": {
          "value": true
        }
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      }
    },
    "relations": {
      "lounge": {
        "kind": "one",
        "model": "Lounge",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "user": {
        "kind": "one",
        "model": "User",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    },
    "uniques": [
      [
        "loungeId",
        "userId"
      ]
    ]
  },
  "FloorZone": {
    "collection": "floorZones",
    "scalars": {
      "id": {
        "type": "String"
      },
      "loungeId": {
        "type": "String"
      },
      "name": {
        "type": "String"
      },
      "color": {
        "type": "String",
        "optional": true
      },
      "sortOrder": {
        "type": "Int",
        "default": {
          "value": 0
        }
      }
    },
    "relations": {
      "lounge": {
        "kind": "one",
        "model": "Lounge",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "devices": {
        "kind": "many",
        "model": "Device",
        "fk": "zoneId",
        "ref": "id",
        "onDelete": "SetNull"
      }
    },
    "uniques": [
      [
        "loungeId",
        "name"
      ]
    ]
  },
  "DeviceCategory": {
    "collection": "deviceCategories",
    "scalars": {
      "id": {
        "type": "String"
      },
      "loungeId": {
        "type": "String"
      },
      "name": {
        "type": "String"
      },
      "type": {
        "type": "Enum"
      },
      "description": {
        "type": "String",
        "optional": true
      },
      "baseHourlyRate": {
        "type": "Decimal"
      },
      "capacity": {
        "type": "Int",
        "default": {
          "value": 1
        }
      },
      "minBookingMinutes": {
        "type": "Int",
        "default": {
          "value": 60
        }
      },
      "slotIntervalMinutes": {
        "type": "Int",
        "default": {
          "value": 30
        }
      },
      "multiTierBps": {
        "type": "Int",
        "optional": true
      },
      "vipTierBps": {
        "type": "Int",
        "optional": true
      },
      "specs": {
        "type": "Json",
        "optional": true
      },
      "iconName": {
        "type": "String",
        "optional": true
      },
      "isActive": {
        "type": "Boolean",
        "default": {
          "value": true
        }
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "lounge": {
        "kind": "one",
        "model": "Lounge",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "devices": {
        "kind": "many",
        "model": "Device",
        "fk": "categoryId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "pricingRules": {
        "kind": "many",
        "model": "PricingRule",
        "fk": "categoryId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    },
    "uniques": [
      [
        "loungeId",
        "name"
      ]
    ]
  },
  "Device": {
    "collection": "devices",
    "scalars": {
      "id": {
        "type": "String"
      },
      "loungeId": {
        "type": "String"
      },
      "categoryId": {
        "type": "String"
      },
      "zoneId": {
        "type": "String",
        "optional": true
      },
      "name": {
        "type": "String"
      },
      "code": {
        "type": "String"
      },
      "status": {
        "type": "Enum",
        "default": {
          "value": "IDLE"
        }
      },
      "ipAddress": {
        "type": "String",
        "optional": true
      },
      "macAddress": {
        "type": "String",
        "optional": true
      },
      "specs": {
        "type": "Json",
        "optional": true
      },
      "notes": {
        "type": "String",
        "optional": true
      },
      "posX": {
        "type": "Int",
        "default": {
          "value": 0
        }
      },
      "posY": {
        "type": "Int",
        "default": {
          "value": 0
        }
      },
      "width": {
        "type": "Int",
        "default": {
          "value": 1
        }
      },
      "height": {
        "type": "Int",
        "default": {
          "value": 1
        }
      },
      "rotation": {
        "type": "Int",
        "default": {
          "value": 0
        }
      },
      "isBookableOnline": {
        "type": "Boolean",
        "default": {
          "value": true
        }
      },
      "lastSeenAt": {
        "type": "DateTime",
        "optional": true
      },
      "hourlyRateOverride": {
        "type": "Decimal",
        "optional": true
      },
      "multiTierBpsOverride": {
        "type": "Int",
        "optional": true
      },
      "vipTierBpsOverride": {
        "type": "Int",
        "optional": true
      },
      "archivedAt": {
        "type": "DateTime",
        "optional": true
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "lounge": {
        "kind": "one",
        "model": "Lounge",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "category": {
        "kind": "one",
        "model": "DeviceCategory",
        "fk": "categoryId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "zone": {
        "kind": "one",
        "model": "FloorZone",
        "fk": "zoneId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "bookings": {
        "kind": "many",
        "model": "Booking",
        "fk": "deviceId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "segments": {
        "kind": "many",
        "model": "SessionSegment",
        "fk": "deviceId",
        "ref": "id",
        "onDelete": "Restrict"
      }
    },
    "uniques": [
      [
        "loungeId",
        "code"
      ],
      [
        "loungeId",
        "name"
      ]
    ]
  },
  "PricingRule": {
    "collection": "pricingRules",
    "scalars": {
      "id": {
        "type": "String"
      },
      "loungeId": {
        "type": "String"
      },
      "categoryId": {
        "type": "String",
        "optional": true
      },
      "name": {
        "type": "String"
      },
      "daysOfWeek": {
        "type": "Int",
        "list": true
      },
      "startMinute": {
        "type": "Int"
      },
      "endMinute": {
        "type": "Int"
      },
      "hourlyRate": {
        "type": "Decimal",
        "optional": true
      },
      "multiplierBps": {
        "type": "Int",
        "optional": true
      },
      "priority": {
        "type": "Int",
        "default": {
          "value": 0
        }
      },
      "validFrom": {
        "type": "DateTime",
        "optional": true
      },
      "validTo": {
        "type": "DateTime",
        "optional": true
      },
      "isActive": {
        "type": "Boolean",
        "default": {
          "value": true
        }
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "lounge": {
        "kind": "one",
        "model": "Lounge",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "category": {
        "kind": "one",
        "model": "DeviceCategory",
        "fk": "categoryId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    },
    "uniques": []
  },
  "Booking": {
    "collection": "bookings",
    "scalars": {
      "id": {
        "type": "String"
      },
      "reference": {
        "type": "String"
      },
      "loungeId": {
        "type": "String"
      },
      "deviceId": {
        "type": "String"
      },
      "customerId": {
        "type": "String",
        "optional": true
      },
      "createdById": {
        "type": "String",
        "optional": true
      },
      "source": {
        "type": "Enum",
        "default": {
          "value": "ONLINE"
        }
      },
      "status": {
        "type": "Enum",
        "default": {
          "value": "PENDING"
        }
      },
      "mode": {
        "type": "Enum",
        "default": {
          "value": "FIXED"
        }
      },
      "priceTier": {
        "type": "Enum",
        "default": {
          "value": "SINGLE"
        }
      },
      "guestName": {
        "type": "String",
        "optional": true
      },
      "guestPhone": {
        "type": "String",
        "optional": true
      },
      "players": {
        "type": "Int",
        "default": {
          "value": 1
        }
      },
      "scheduledStart": {
        "type": "DateTime"
      },
      "scheduledEnd": {
        "type": "DateTime"
      },
      "actualStart": {
        "type": "DateTime",
        "optional": true
      },
      "actualEnd": {
        "type": "DateTime",
        "optional": true
      },
      "pausedAt": {
        "type": "DateTime",
        "optional": true
      },
      "pausedMinutes": {
        "type": "Int",
        "default": {
          "value": 0
        }
      },
      "currency": {
        "type": "String"
      },
      "hourlyRate": {
        "type": "Decimal"
      },
      "playSubtotal": {
        "type": "Decimal",
        "default": {
          "value": 0
        }
      },
      "canteenSubtotal": {
        "type": "Decimal",
        "default": {
          "value": 0
        }
      },
      "discountTotal": {
        "type": "Decimal",
        "default": {
          "value": 0
        }
      },
      "taxTotal": {
        "type": "Decimal",
        "default": {
          "value": 0
        }
      },
      "totalPrice": {
        "type": "Decimal",
        "default": {
          "value": 0
        }
      },
      "amountPaid": {
        "type": "Decimal",
        "default": {
          "value": 0
        }
      },
      "paymentStatus": {
        "type": "Enum",
        "default": {
          "value": "UNPAID"
        }
      },
      "checkoutMethod": {
        "type": "Enum",
        "default": {
          "value": "PAY_AT_LOUNGE"
        }
      },
      "expiresAt": {
        "type": "DateTime",
        "optional": true
      },
      "notes": {
        "type": "String",
        "optional": true
      },
      "cancelledAt": {
        "type": "DateTime",
        "optional": true
      },
      "cancelReason": {
        "type": "String",
        "optional": true
      },
      "version": {
        "type": "Int",
        "default": {
          "value": 0
        }
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "lounge": {
        "kind": "one",
        "model": "Lounge",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "device": {
        "kind": "one",
        "model": "Device",
        "fk": "deviceId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "customer": {
        "kind": "one",
        "model": "User",
        "fk": "customerId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "createdBy": {
        "kind": "one",
        "model": "User",
        "fk": "createdById",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "extensions": {
        "kind": "many",
        "model": "BookingExtension",
        "fk": "bookingId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "segments": {
        "kind": "many",
        "model": "SessionSegment",
        "fk": "bookingId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "canteenOrders": {
        "kind": "many",
        "model": "CanteenOrder",
        "fk": "bookingId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "transactions": {
        "kind": "many",
        "model": "Transaction",
        "fk": "bookingId",
        "ref": "id",
        "onDelete": "SetNull"
      }
    },
    "uniques": [
      [
        "reference"
      ]
    ]
  },
  "BookingExtension": {
    "collection": "bookingExtensions",
    "scalars": {
      "id": {
        "type": "String"
      },
      "bookingId": {
        "type": "String"
      },
      "minutes": {
        "type": "Int"
      },
      "price": {
        "type": "Decimal"
      },
      "previousEnd": {
        "type": "DateTime"
      },
      "newEnd": {
        "type": "DateTime"
      },
      "addedById": {
        "type": "String",
        "optional": true
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      }
    },
    "relations": {
      "booking": {
        "kind": "one",
        "model": "Booking",
        "fk": "bookingId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "addedBy": {
        "kind": "one",
        "model": "User",
        "fk": "addedById",
        "ref": "id",
        "onDelete": "SetNull"
      }
    },
    "uniques": []
  },
  "SessionSegment": {
    "collection": "sessionSegments",
    "scalars": {
      "id": {
        "type": "String"
      },
      "bookingId": {
        "type": "String"
      },
      "deviceId": {
        "type": "String"
      },
      "priceTier": {
        "type": "Enum"
      },
      "startedAt": {
        "type": "DateTime"
      },
      "endedAt": {
        "type": "DateTime",
        "optional": true
      },
      "minutes": {
        "type": "Int",
        "optional": true
      },
      "amount": {
        "type": "Decimal",
        "optional": true
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      }
    },
    "relations": {
      "booking": {
        "kind": "one",
        "model": "Booking",
        "fk": "bookingId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "device": {
        "kind": "one",
        "model": "Device",
        "fk": "deviceId",
        "ref": "id",
        "onDelete": "Restrict"
      }
    },
    "uniques": []
  },
  "MenuCategory": {
    "collection": "menuCategories",
    "scalars": {
      "id": {
        "type": "String"
      },
      "loungeId": {
        "type": "String"
      },
      "name": {
        "type": "String"
      },
      "nameEn": {
        "type": "String",
        "optional": true
      },
      "kind": {
        "type": "Enum",
        "default": {
          "value": "OTHER"
        }
      },
      "sortOrder": {
        "type": "Int",
        "default": {
          "value": 0
        }
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "lounge": {
        "kind": "one",
        "model": "Lounge",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "items": {
        "kind": "many",
        "model": "MenuItem",
        "fk": "menuCategoryId",
        "ref": "id",
        "onDelete": "Restrict"
      }
    },
    "uniques": [
      [
        "loungeId",
        "name"
      ]
    ]
  },
  "MenuItem": {
    "collection": "menuItems",
    "scalars": {
      "id": {
        "type": "String"
      },
      "loungeId": {
        "type": "String"
      },
      "menuCategoryId": {
        "type": "String"
      },
      "name": {
        "type": "String"
      },
      "nameEn": {
        "type": "String",
        "optional": true
      },
      "description": {
        "type": "String",
        "optional": true
      },
      "category": {
        "type": "Enum"
      },
      "price": {
        "type": "Decimal"
      },
      "costPrice": {
        "type": "Decimal",
        "optional": true
      },
      "imageUrl": {
        "type": "String",
        "optional": true
      },
      "iconName": {
        "type": "String",
        "optional": true
      },
      "sku": {
        "type": "String",
        "optional": true
      },
      "stockQuantity": {
        "type": "Int",
        "optional": true
      },
      "lowStockAt": {
        "type": "Int",
        "default": {
          "value": 5
        }
      },
      "isAvailable": {
        "type": "Boolean",
        "default": {
          "value": true
        }
      },
      "sortOrder": {
        "type": "Int",
        "default": {
          "value": 0
        }
      },
      "archivedAt": {
        "type": "DateTime",
        "optional": true
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "lounge": {
        "kind": "one",
        "model": "Lounge",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "menuCategory": {
        "kind": "one",
        "model": "MenuCategory",
        "fk": "menuCategoryId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "orderItems": {
        "kind": "many",
        "model": "CanteenOrderItem",
        "fk": "menuItemId",
        "ref": "id",
        "onDelete": "Restrict"
      }
    },
    "uniques": [
      [
        "loungeId",
        "sku"
      ]
    ]
  },
  "CanteenOrder": {
    "collection": "canteenOrders",
    "scalars": {
      "id": {
        "type": "String"
      },
      "loungeId": {
        "type": "String"
      },
      "bookingId": {
        "type": "String",
        "optional": true
      },
      "customerId": {
        "type": "String",
        "optional": true
      },
      "createdById": {
        "type": "String",
        "optional": true
      },
      "status": {
        "type": "Enum",
        "default": {
          "value": "PENDING"
        }
      },
      "isPreOrder": {
        "type": "Boolean",
        "default": {
          "value": false
        }
      },
      "subtotal": {
        "type": "Decimal"
      },
      "taxTotal": {
        "type": "Decimal",
        "default": {
          "value": 0
        }
      },
      "total": {
        "type": "Decimal"
      },
      "notes": {
        "type": "String",
        "optional": true
      },
      "servedAt": {
        "type": "DateTime",
        "optional": true
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "lounge": {
        "kind": "one",
        "model": "Lounge",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "booking": {
        "kind": "one",
        "model": "Booking",
        "fk": "bookingId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "customer": {
        "kind": "one",
        "model": "User",
        "fk": "customerId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "createdBy": {
        "kind": "one",
        "model": "User",
        "fk": "createdById",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "items": {
        "kind": "many",
        "model": "CanteenOrderItem",
        "fk": "orderId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "transactions": {
        "kind": "many",
        "model": "Transaction",
        "fk": "canteenOrderId",
        "ref": "id",
        "onDelete": "SetNull"
      }
    },
    "uniques": []
  },
  "CanteenOrderItem": {
    "collection": "canteenOrderItems",
    "scalars": {
      "id": {
        "type": "String"
      },
      "orderId": {
        "type": "String"
      },
      "menuItemId": {
        "type": "String"
      },
      "name": {
        "type": "String"
      },
      "unitPrice": {
        "type": "Decimal"
      },
      "quantity": {
        "type": "Int"
      },
      "lineTotal": {
        "type": "Decimal"
      }
    },
    "relations": {
      "order": {
        "kind": "one",
        "model": "CanteenOrder",
        "fk": "orderId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "menuItem": {
        "kind": "one",
        "model": "MenuItem",
        "fk": "menuItemId",
        "ref": "id",
        "onDelete": "Restrict"
      }
    },
    "uniques": []
  },
  "Wallet": {
    "collection": "wallets",
    "scalars": {
      "id": {
        "type": "String"
      },
      "userId": {
        "type": "String"
      },
      "balance": {
        "type": "Decimal",
        "default": {
          "value": 0
        }
      },
      "currency": {
        "type": "String",
        "default": {
          "value": "IQD"
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "user": {
        "kind": "one",
        "model": "User",
        "fk": "userId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    },
    "uniques": [
      [
        "userId"
      ]
    ]
  },
  "Transaction": {
    "collection": "transactions",
    "scalars": {
      "id": {
        "type": "String"
      },
      "loungeId": {
        "type": "String",
        "optional": true
      },
      "bookingId": {
        "type": "String",
        "optional": true
      },
      "canteenOrderId": {
        "type": "String",
        "optional": true
      },
      "payoutId": {
        "type": "String",
        "optional": true
      },
      "shiftId": {
        "type": "String",
        "optional": true
      },
      "userId": {
        "type": "String",
        "optional": true
      },
      "processedById": {
        "type": "String",
        "optional": true
      },
      "type": {
        "type": "Enum"
      },
      "method": {
        "type": "Enum"
      },
      "status": {
        "type": "Enum",
        "default": {
          "value": "PENDING"
        }
      },
      "amount": {
        "type": "Decimal"
      },
      "currency": {
        "type": "String"
      },
      "provider": {
        "type": "String",
        "optional": true
      },
      "providerRef": {
        "type": "String",
        "optional": true
      },
      "metadata": {
        "type": "Json",
        "optional": true
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      }
    },
    "relations": {
      "lounge": {
        "kind": "one",
        "model": "Lounge",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "booking": {
        "kind": "one",
        "model": "Booking",
        "fk": "bookingId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "canteenOrder": {
        "kind": "one",
        "model": "CanteenOrder",
        "fk": "canteenOrderId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "payout": {
        "kind": "one",
        "model": "Payout",
        "fk": "payoutId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "shift": {
        "kind": "one",
        "model": "Shift",
        "fk": "shiftId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "user": {
        "kind": "one",
        "model": "User",
        "fk": "userId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "processedBy": {
        "kind": "one",
        "model": "User",
        "fk": "processedById",
        "ref": "id",
        "onDelete": "SetNull"
      }
    },
    "uniques": [
      [
        "provider",
        "providerRef"
      ]
    ]
  },
  "Shift": {
    "collection": "shifts",
    "scalars": {
      "id": {
        "type": "String"
      },
      "loungeId": {
        "type": "String"
      },
      "cashierId": {
        "type": "String"
      },
      "status": {
        "type": "Enum",
        "default": {
          "value": "OPEN"
        }
      },
      "shiftType": {
        "type": "Enum",
        "optional": true
      },
      "openedAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "closedAt": {
        "type": "DateTime",
        "optional": true
      },
      "closedById": {
        "type": "String",
        "optional": true
      },
      "openingFloat": {
        "type": "Decimal"
      },
      "expectedCash": {
        "type": "Decimal",
        "optional": true
      },
      "countedCash": {
        "type": "Decimal",
        "optional": true
      },
      "variance": {
        "type": "Decimal",
        "optional": true
      },
      "notes": {
        "type": "String",
        "optional": true
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "lounge": {
        "kind": "one",
        "model": "Lounge",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "cashier": {
        "kind": "one",
        "model": "User",
        "fk": "cashierId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "closedBy": {
        "kind": "one",
        "model": "User",
        "fk": "closedById",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "transactions": {
        "kind": "many",
        "model": "Transaction",
        "fk": "shiftId",
        "ref": "id",
        "onDelete": "SetNull"
      },
      "expenses": {
        "kind": "many",
        "model": "ShiftExpense",
        "fk": "shiftId",
        "ref": "id",
        "onDelete": "Cascade"
      }
    },
    "uniques": []
  },
  "ShiftExpense": {
    "collection": "shiftExpenses",
    "scalars": {
      "id": {
        "type": "String"
      },
      "shiftId": {
        "type": "String"
      },
      "loungeId": {
        "type": "String"
      },
      "amount": {
        "type": "Decimal"
      },
      "reason": {
        "type": "String"
      },
      "createdById": {
        "type": "String"
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "voidedAt": {
        "type": "DateTime",
        "optional": true
      },
      "voidedById": {
        "type": "String",
        "optional": true
      }
    },
    "relations": {
      "shift": {
        "kind": "one",
        "model": "Shift",
        "fk": "shiftId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "lounge": {
        "kind": "one",
        "model": "Lounge",
        "fk": "loungeId",
        "ref": "id",
        "onDelete": "Cascade"
      },
      "createdBy": {
        "kind": "one",
        "model": "User",
        "fk": "createdById",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "voidedBy": {
        "kind": "one",
        "model": "User",
        "fk": "voidedById",
        "ref": "id",
        "onDelete": "SetNull"
      }
    },
    "uniques": []
  },
  "Payout": {
    "collection": "payouts",
    "scalars": {
      "id": {
        "type": "String"
      },
      "organizationId": {
        "type": "String"
      },
      "periodStart": {
        "type": "DateTime"
      },
      "periodEnd": {
        "type": "DateTime"
      },
      "grossAmount": {
        "type": "Decimal"
      },
      "commissionAmount": {
        "type": "Decimal"
      },
      "netAmount": {
        "type": "Decimal"
      },
      "currency": {
        "type": "String"
      },
      "status": {
        "type": "Enum",
        "default": {
          "value": "PENDING"
        }
      },
      "paidAt": {
        "type": "DateTime",
        "optional": true
      },
      "externalRef": {
        "type": "String",
        "optional": true
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      },
      "updatedAt": {
        "type": "DateTime",
        "updatedAt": true
      }
    },
    "relations": {
      "organization": {
        "kind": "one",
        "model": "Organization",
        "fk": "organizationId",
        "ref": "id",
        "onDelete": "Restrict"
      },
      "transactions": {
        "kind": "many",
        "model": "Transaction",
        "fk": "payoutId",
        "ref": "id",
        "onDelete": "SetNull"
      }
    },
    "uniques": []
  },
  "AuditLog": {
    "collection": "auditLogs",
    "scalars": {
      "id": {
        "type": "String"
      },
      "actorId": {
        "type": "String",
        "optional": true
      },
      "loungeId": {
        "type": "String",
        "optional": true
      },
      "action": {
        "type": "String"
      },
      "entityType": {
        "type": "String"
      },
      "entityId": {
        "type": "String"
      },
      "data": {
        "type": "Json",
        "optional": true
      },
      "createdAt": {
        "type": "DateTime",
        "default": {
          "now": true
        }
      }
    },
    "relations": {
      "actor": {
        "kind": "one",
        "model": "User",
        "fk": "actorId",
        "ref": "id",
        "onDelete": "SetNull"
      }
    },
    "uniques": []
  }
};
