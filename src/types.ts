// ==================== Cloudflare Worker Environment ====================

export interface Env {
  MCP_OBJECT: DurableObjectNamespace;
  LINKEDIN_CLIENT_ID: string;
  LINKEDIN_CLIENT_SECRET: string;
  LINKEDIN_REFRESH_TOKEN: string;
}

// ==================== LinkedIn OAuth ====================

export interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

// ==================== LinkedIn API Response Types ====================

export interface LinkedInApiResponse<T> {
  elements: T[];
  paging?: {
    count: number;
    start: number;
    total?: number;
    links?: Array<{
      rel: string;
      href: string;
    }>;
  };
}

export interface LinkedInApiError {
  status: number;
  serviceErrorCode?: number;
  code?: string;
  message: string;
}

// ==================== Account Types ====================

export interface AdAccount {
  id: string;
  name: string;
  currency: string;
  type: "BUSINESS" | "ENTERPRISE";
  status: "ACTIVE" | "DRAFT" | "CANCELED" | "PENDING_DELETION" | "REMOVED";
  servingStatuses: string[];
  reference: string;
  notifiedOnCampaignOptimization: boolean;
  notifiedOnCreativeApproval: boolean;
  notifiedOnCreativeRejection: boolean;
  notifiedOnEndOfCampaign: boolean;
  test: boolean;
  version?: {
    versionTag: string;
  };
}

// ==================== Campaign Types ====================

export interface CampaignGroup {
  id: string;
  account: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED" | "DRAFT" | "CANCELED";
  runSchedule?: {
    start: number;
    end?: number;
  };
  totalBudget?: {
    amount: string;
    currencyCode: string;
  };
}

export interface Campaign {
  id: string;
  account: string;
  campaignGroup: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED" | "DRAFT" | "CANCELED";
  type: string;
  objectiveType: string;
  costType: string;
  dailyBudget?: {
    amount: string;
    currencyCode: string;
  };
  totalBudget?: {
    amount: string;
    currencyCode: string;
  };
  runSchedule?: {
    start: number;
    end?: number;
  };
}

export interface Creative {
  id: string;
  campaign: string;
  status: "ACTIVE" | "PAUSED" | "DRAFT" | "ARCHIVED" | "CANCELED";
  type: string;
  name?: string;
  content?: {
    reference?: string;
    textAd?: { text?: string };
  };
  review?: {
    status: string;
    reviewedAt?: number;
  };
}

// ==================== Analytics Types ====================

export interface DateRange {
  start: {
    year: number;
    month: number;
    day: number;
  };
  end: {
    year: number;
    month: number;
    day: number;
  };
}

export interface AnalyticsRecord {
  pivotValues: string[];
  dateRange?: DateRange;
  [key: string]: unknown;
}

export type DemographicPivot =
  | "MEMBER_JOB_FUNCTION"
  | "MEMBER_SENIORITY"
  | "MEMBER_INDUSTRY"
  | "MEMBER_COMPANY_SIZE"
  | "MEMBER_JOB_TITLE"
  | "MEMBER_COMPANY"
  | "MEMBER_COUNTRY"
  | "MEMBER_COUNTRY_V2"
  | "MEMBER_REGION"
  | "MEMBER_REGION_V2";

export type EntityPivot =
  | "ACCOUNT"
  | "CAMPAIGN_GROUP"
  | "CAMPAIGN"
  | "CREATIVE"
  | "CONVERSION";

export type TimeGranularity = "ALL" | "DAILY" | "MONTHLY" | "YEARLY";

// ==================== Conversion Types ====================

export interface Conversion {
  id: string;
  name: string;
  account: string;
  type: string;
  enabled: boolean;
  postClickAttributionWindowSize: number;
  viewThroughAttributionWindowSize: number;
  attributionType: string;
  conversionMethod?: string;
}

// ==================== Lead Gen Types ====================

export interface LeadGenForm {
  id: string;
  name: string;
  account: string;
  status: "DRAFT" | "SUBMITTED" | "PUBLISHED" | "ARCHIVED";
  headline: string;
  description?: string;
  thankYouMessage: string;
  landingPageUrl?: string;
  questions?: LeadGenFormQuestion[];
}

export interface LeadGenFormQuestion {
  questionId: number;
  questionType: string;
  questionText: string;
  required: boolean;
  predefinedField?: string;
}

// ==================== Audience Types ====================

export interface SavedAudience {
  id: string;
  name: string;
  account: string;
  type: "MATCHED" | "LOOKALIKE" | "PREDICTIVE";
  status: "ACTIVE" | "EXPIRED" | "PROCESSING" | "FAILED";
  memberCount?: number;
  matchRate?: number;
  createdAt: number;
  lastModified: number;
}

// ==================== Request Options ====================

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  params?: Record<string, string | string[] | number | boolean | undefined>;
  restliMethod?:
    | "FINDER"
    | "BATCH_GET"
    | "GET"
    | "CREATE"
    | "UPDATE"
    | "DELETE"
    | "PARTIAL_UPDATE"
    | "BATCH_PARTIAL_UPDATE"
    | "BATCH_CREATE";
  rawResponse?: boolean;
}

// ==================== Standard Metrics ====================

export interface StandardMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  frequency: number | null;
  engagements: number;
  engagementRate: number | null;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  conversions: number;
  conversionRate: number | null;
  costPerConversion: number | null;
  audiencePenetration: number | null;
  averageDwellTime: number | null;
}
