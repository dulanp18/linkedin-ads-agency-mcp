import type {
  Env,
  LinkedInTokenResponse,
  LinkedInApiResponse,
  LinkedInApiError,
  AdAccount,
  Campaign,
  CampaignGroup,
  Creative,
  Conversion,
  LeadGenForm,
  SavedAudience,
  AnalyticsRecord,
  DemographicPivot,
  EntityPivot,
  TimeGranularity,
  RequestOptions,
} from "./types.js";

const LINKEDIN_API_BASE = "https://api.linkedin.com";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_VERSION = "202601"; // January 2026 API version

// Default metrics for different report types
const DEFAULT_PERFORMANCE_METRICS = [
  "impressions",
  "clicks",
  "landingPageClicks",
  "totalEngagements",
  "costInUsd",
  "costInLocalCurrency",
  "externalWebsiteConversions",
  "approximateUniqueImpressions",
  "averageDwellTime",
  "audiencePenetration",
];

const DEFAULT_CREATIVE_METRICS = [
  ...DEFAULT_PERFORMANCE_METRICS,
  "likes",
  "comments",
  "shares",
  "reactions",
  "follows",
];

const VIDEO_METRICS = [
  "videoViews",
  "videoStarts",
  "videoCompletions",
  "videoFirstQuartileCompletions",
  "videoMidpointCompletions",
  "videoThirdQuartileCompletions",
];

const LEAD_GEN_METRICS = [
  "oneClickLeads",
  "oneClickLeadFormOpens",
  "qualifiedLeads",
];

const REACH_METRICS = [
  "approximateMemberReach",
  "impressions",
  "audiencePenetration",
];

export class LinkedInAdsClient {
  private env: Env;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private retryCount = 3;
  private retryDelay = 1000;

  constructor(env: Env) {
    this.env = env;
  }

  // ==================== Auth ====================

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await fetch(LINKEDIN_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.env.LINKEDIN_REFRESH_TOKEN,
        client_id: this.env.LINKEDIN_CLIENT_ID,
        client_secret: this.env.LINKEDIN_CLIENT_SECRET,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to refresh LinkedIn access token: ${error}`);
    }

    const data = (await response.json()) as LinkedInTokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return this.accessToken;
  }

  // ==================== Core Request ====================

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const accessToken = await this.getAccessToken();

    let urlString = `${LINKEDIN_API_BASE}${endpoint}`;
    const queryParts: string[] = [];

    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) {
          if (Array.isArray(value)) {
            queryParts.push(
              `${key}=List(${value.map((v) => encodeURIComponent(v)).join(",")})`
            );
          } else if (key === "fields" || key === "dateRange") {
            queryParts.push(`${key}=${value}`);
          } else {
            queryParts.push(`${key}=${encodeURIComponent(String(value))}`);
          }
        }
      }
    }

    if (queryParts.length > 0) {
      urlString += "?" + queryParts.join("&");
    }

    const url = new URL(urlString);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "LinkedIn-Version": LINKEDIN_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    };

    if (options.restliMethod) {
      headers["X-RestLi-Method"] = options.restliMethod;
    }

    if (options.body) {
      headers["Content-Type"] = "application/json";
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryCount; attempt++) {
      try {
        const response = await fetch(url.toString(), {
          method: options.method || "GET",
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
        });

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const waitTime = retryAfter
            ? parseInt(retryAfter) * 1000
            : this.retryDelay * Math.pow(2, attempt);
          await this.sleep(waitTime);
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          let errorData: LinkedInApiError;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { status: response.status, message: errorText };
          }
          throw new Error(
            `LinkedIn API error (${response.status}): ${errorData.message}`
          );
        }

        if (options.rawResponse) {
          return response as unknown as T;
        }

        const contentLength = response.headers.get("content-length");
        if (
          response.status === 204 ||
          response.status === 201 ||
          contentLength === "0"
        ) {
          const restliId = response.headers.get("x-restli-id");
          if (restliId) {
            return { id: restliId } as T;
          }
          return {} as T;
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (
          lastError.message.includes("Not authenticated") ||
          lastError.message.includes("Invalid access token")
        ) {
          throw lastError;
        }

        if (attempt < this.retryCount - 1) {
          const waitTime = this.retryDelay * Math.pow(2, attempt);
          await this.sleep(waitTime);
        }
      }
    }

    throw lastError || new Error("Request failed after retries");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==================== Date Helpers ====================

  private formatDateRange(startDate: string, endDate?: string): string {
    const start = this.parseDate(startDate);
    const end = endDate
      ? this.parseDate(endDate)
      : this.parseDate(new Date().toISOString().split("T")[0]);

    return `(start:(year:${start.year},month:${start.month},day:${start.day}),end:(year:${end.year},month:${end.month},day:${end.day}))`;
  }

  private parseDate(dateStr: string): {
    year: number;
    month: number;
    day: number;
  } {
    const [year, month, day] = dateStr.split("-").map(Number);
    return { year, month, day };
  }

  // ==================== Account Management ====================

  async listAdAccounts(
    options: {
      status?: string[];
      type?: string;
      includeTest?: boolean;
    } = {}
  ): Promise<AdAccount[]> {
    const params: Record<string, string | string[]> = {
      q: "search",
    };

    if (options.status?.length) {
      params["search.status.values"] = options.status;
    }
    if (options.type) {
      params["search.type.values"] = [options.type];
    }

    const response = await this.request<LinkedInApiResponse<AdAccount>>(
      "/rest/adAccounts",
      { params }
    );

    let accounts = response.elements || [];

    if (!options.includeTest) {
      accounts = accounts.filter((account) => !account.test);
    }

    return accounts;
  }

  async getAccountDetails(accountId: string): Promise<AdAccount> {
    return this.request<AdAccount>(`/rest/adAccounts/${accountId}`);
  }

  // ==================== Campaign Management ====================

  async listCampaigns(
    accountId: string,
    options: {
      campaignGroupIds?: string[];
      status?: string[];
    } = {}
  ): Promise<Campaign[]> {
    const params: Record<string, string | string[]> = {
      q: "search",
    };

    if (options.campaignGroupIds?.length) {
      params["search.campaignGroup.values"] = options.campaignGroupIds.map(
        (id) => `urn:li:sponsoredCampaignGroup:${id}`
      );
    }
    if (options.status?.length) {
      params["search.status.values"] = options.status;
    }

    try {
      const response = await this.request<LinkedInApiResponse<Campaign>>(
        `/rest/adAccounts/${accountId}/adCampaigns`,
        { params }
      );
      return response.elements || [];
    } catch (error) {
      console.error("Failed to fetch campaigns:", error);
      return [];
    }
  }

  async getCampaign(
    accountId: string,
    campaignId: string
  ): Promise<Campaign | null> {
    try {
      return await this.request<Campaign>(
        `/rest/adAccounts/${accountId}/adCampaigns/${campaignId}`
      );
    } catch (error) {
      console.error(`Failed to fetch campaign ${campaignId}:`, error);
      return null;
    }
  }

  async getCampaignsByIds(
    accountId: string,
    campaignIds: string[]
  ): Promise<Map<string, Campaign>> {
    const campaignMap = new Map<string, Campaign>();
    const batchSize = 10;

    for (let i = 0; i < campaignIds.length; i += batchSize) {
      const batch = campaignIds.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((id) => this.getCampaign(accountId, id))
      );
      results.forEach((campaign, idx) => {
        if (campaign) {
          campaignMap.set(batch[idx], campaign);
        }
      });
    }

    return campaignMap;
  }

  async listCampaignGroups(
    accountId: string,
    options: { status?: string[] } = {}
  ): Promise<CampaignGroup[]> {
    const params: Record<string, string | string[]> = {
      q: "search",
    };

    if (options.status?.length) {
      params["search.status.values"] = options.status;
    }

    const response = await this.request<LinkedInApiResponse<CampaignGroup>>(
      `/rest/adAccounts/${accountId}/adCampaignGroups`,
      { params }
    );
    return response.elements || [];
  }

  // ==================== Creatives ====================

  async listCreatives(
    accountId: string,
    options: {
      campaignIds?: string[];
      creativeIds?: string[];
      isTestAccount?: boolean;
      pageSize?: number;
    } = {}
  ): Promise<Creative[]> {
    const params: Record<string, string | string[]> = {
      q: "criteria",
      pageSize: String(options.pageSize ?? 100),
    };

    if (options.campaignIds?.length) {
      params.campaigns = options.campaignIds.map(
        (id) => `urn:li:sponsoredCampaign:${id}`
      );
    }
    if (options.creativeIds?.length) {
      params.creatives = options.creativeIds.map(
        (id) => `urn:li:sponsoredCreative:${id}`
      );
    }
    if (options.isTestAccount !== undefined) {
      params.isTestAccount = String(options.isTestAccount);
    }

    try {
      const response = await this.request<LinkedInApiResponse<Creative>>(
        `/rest/adAccounts/${accountId}/creatives`,
        { params, restliMethod: "FINDER" }
      );
      return response.elements || [];
    } catch (error) {
      console.error("Failed to fetch creatives:", error);
      return [];
    }
  }

  async getCreativesByIds(
    accountId: string,
    creativeIds: string[]
  ): Promise<Map<string, Creative>> {
    const creativeMap = new Map<string, Creative>();
    const batchSize = 50;

    for (let i = 0; i < creativeIds.length; i += batchSize) {
      const batchIds = creativeIds.slice(i, i + batchSize);

      try {
        const creatives = await this.listCreatives(accountId, {
          creativeIds: batchIds,
          pageSize: 100,
        });

        for (const creative of creatives) {
          const idMatch = creative.id?.match(/urn:li:sponsoredCreative:(\d+)/);
          if (idMatch) {
            creativeMap.set(idMatch[1], creative);
          }
        }
      } catch (error) {
        console.error("Failed to fetch batch of creatives:", error);
      }
    }

    return creativeMap;
  }

  // ==================== Content (Posts & Images) ====================

  async getPost(postUrn: string): Promise<Record<string, unknown> | null> {
    try {
      const encodedUrn = encodeURIComponent(postUrn);
      return await this.request<Record<string, unknown>>(
        `/rest/posts/${encodedUrn}`
      );
    } catch (error) {
      console.error(`Failed to fetch post ${postUrn}:`, error);
      return null;
    }
  }

  async getImage(
    imageUrn: string
  ): Promise<{ downloadUrl: string; status: string } | null> {
    try {
      const encodedUrn = encodeURIComponent(imageUrn);
      return await this.request<{ downloadUrl: string; status: string }>(
        `/rest/images/${encodedUrn}`
      );
    } catch (error) {
      console.error(`Failed to fetch image ${imageUrn}:`, error);
      return null;
    }
  }

  // ==================== Analytics ====================

  async getAnalytics(options: {
    accountId: string;
    pivot: EntityPivot | DemographicPivot;
    startDate: string;
    endDate?: string;
    timeGranularity?: TimeGranularity;
    campaigns?: string[];
    campaignGroups?: string[];
    metrics?: string[];
  }): Promise<AnalyticsRecord[]> {
    const dateRange = this.formatDateRange(
      options.startDate,
      options.endDate
    );
    const metrics = options.metrics || DEFAULT_PERFORMANCE_METRICS;

    const fieldsToRequest = [...metrics, "pivotValues"];
    if (options.timeGranularity && options.timeGranularity !== "ALL") {
      fieldsToRequest.push("dateRange");
    }

    const params: Record<string, string | string[]> = {
      q: "analytics",
      pivot: options.pivot,
      dateRange,
      timeGranularity: options.timeGranularity || "ALL",
      accounts: [`urn:li:sponsoredAccount:${options.accountId}`],
      fields: fieldsToRequest.join(","),
    };

    if (options.campaigns?.length) {
      params.campaigns = options.campaigns.map(
        (id) => `urn:li:sponsoredCampaign:${id}`
      );
    }
    if (options.campaignGroups?.length) {
      params.campaignGroups = options.campaignGroups.map(
        (id) => `urn:li:sponsoredCampaignGroup:${id}`
      );
    }

    const response = await this.request<LinkedInApiResponse<AnalyticsRecord>>(
      "/rest/adAnalytics",
      { params }
    );
    return response.elements || [];
  }

  async getCampaignPerformance(options: {
    accountId: string;
    campaignIds?: string[];
    campaignGroupIds?: string[];
    startDate: string;
    endDate?: string;
    timeGranularity?: TimeGranularity;
    metrics?: string[];
  }): Promise<AnalyticsRecord[]> {
    return this.getAnalytics({
      ...options,
      pivot: "CAMPAIGN",
      campaigns: options.campaignIds,
      campaignGroups: options.campaignGroupIds,
    });
  }

  async getCreativePerformance(options: {
    accountId: string;
    campaignIds?: string[];
    startDate: string;
    endDate?: string;
    timeGranularity?: TimeGranularity;
    includeVideoMetrics?: boolean;
  }): Promise<AnalyticsRecord[]> {
    let metrics = DEFAULT_CREATIVE_METRICS.filter(
      (m) => m !== "audiencePenetration" && m !== "costInLocalCurrency"
    );
    if (options.includeVideoMetrics !== false) {
      metrics = [...metrics, ...VIDEO_METRICS];
    }

    return this.getAnalytics({
      accountId: options.accountId,
      pivot: "CREATIVE",
      startDate: options.startDate,
      endDate: options.endDate,
      timeGranularity: options.timeGranularity,
      campaigns: options.campaignIds,
      metrics,
    });
  }

  async getCampaignGroupPerformance(options: {
    accountId: string;
    startDate: string;
    endDate?: string;
    timeGranularity?: TimeGranularity;
  }): Promise<AnalyticsRecord[]> {
    return this.getAnalytics({
      ...options,
      pivot: "CAMPAIGN_GROUP",
    });
  }

  async getAudienceDemographics(options: {
    accountId: string;
    demographicType: DemographicPivot;
    campaignIds?: string[];
    startDate: string;
    endDate?: string;
  }): Promise<AnalyticsRecord[]> {
    return this.getAnalytics({
      accountId: options.accountId,
      pivot: options.demographicType,
      startDate: options.startDate,
      endDate: options.endDate,
      campaigns: options.campaignIds,
      metrics: [...DEFAULT_PERFORMANCE_METRICS, "totalEngagements"],
    });
  }

  async getAudienceReach(options: {
    accountId: string;
    campaignIds?: string[];
    campaignGroupIds?: string[];
    startDate: string;
    endDate?: string;
  }): Promise<AnalyticsRecord[]> {
    return this.getAnalytics({
      accountId: options.accountId,
      pivot: options.campaignIds?.length ? "CAMPAIGN" : "ACCOUNT",
      startDate: options.startDate,
      endDate: options.endDate,
      campaigns: options.campaignIds,
      campaignGroups: options.campaignGroupIds,
      metrics: REACH_METRICS,
    });
  }

  async getLeadGenPerformance(options: {
    accountId: string;
    campaignIds?: string[];
    startDate: string;
    endDate?: string;
    timeGranularity?: TimeGranularity;
  }): Promise<AnalyticsRecord[]> {
    return this.getAnalytics({
      accountId: options.accountId,
      pivot: "CAMPAIGN",
      startDate: options.startDate,
      endDate: options.endDate,
      campaigns: options.campaignIds,
      timeGranularity: options.timeGranularity,
      metrics: [...LEAD_GEN_METRICS, "costInUsd", "impressions", "clicks"],
    });
  }

  async getConversionPerformance(options: {
    accountId: string;
    campaignIds?: string[];
    startDate: string;
    endDate?: string;
    includePostView?: boolean;
    timeGranularity?: TimeGranularity;
  }): Promise<AnalyticsRecord[]> {
    const metrics = [
      "externalWebsiteConversions",
      "externalWebsitePostClickConversions",
      "costInUsd",
      "conversionValueInLocalCurrency",
    ];

    if (options.includePostView !== false) {
      metrics.push("externalWebsitePostViewConversions");
    }

    return this.getAnalytics({
      accountId: options.accountId,
      pivot: "CONVERSION",
      startDate: options.startDate,
      endDate: options.endDate,
      campaigns: options.campaignIds,
      timeGranularity: options.timeGranularity,
      metrics,
    });
  }

  // ==================== Conversions ====================

  async listConversions(
    accountId: string,
    enabledOnly = false
  ): Promise<Conversion[]> {
    const params: Record<string, string> = {
      q: "account",
      account: `urn:li:sponsoredAccount:${accountId}`,
    };

    const response = await this.request<LinkedInApiResponse<Conversion>>(
      "/rest/conversions",
      { params }
    );
    let conversions = response.elements || [];

    if (enabledOnly) {
      conversions = conversions.filter((c) => c.enabled);
    }

    return conversions;
  }

  // ==================== Lead Gen ====================

  async listLeadForms(
    accountId: string,
    status?: string[]
  ): Promise<LeadGenForm[]> {
    const params: Record<string, string | string[]> = {
      q: "owner",
      owner: `(sponsoredAccount:urn:li:sponsoredAccount:${accountId})`,
    };

    const response = await this.request<LinkedInApiResponse<LeadGenForm>>(
      "/rest/leadForms",
      { params }
    );
    let forms = response.elements || [];

    if (status?.length) {
      forms = forms.filter((f) => status.includes(f.status));
    }

    return forms;
  }

  // ==================== Audiences ====================

  async listSavedAudiences(
    accountId: string,
    options: { status?: string[]; type?: string } = {}
  ): Promise<SavedAudience[]> {
    const params: Record<string, string> = {
      q: "account",
      account: `urn:li:sponsoredAccount:${accountId}`,
    };

    const response = await this.request<LinkedInApiResponse<SavedAudience>>(
      "/rest/dmpSegments",
      { params }
    );
    let audiences = response.elements || [];

    if (options.status?.length) {
      audiences = audiences.filter((a) => options.status!.includes(a.status));
    }
    if (options.type) {
      audiences = audiences.filter((a) => a.type === options.type);
    }

    return audiences;
  }

  // ==================== Campaign Group Write ====================

  async createCampaignGroup(
    accountId: string,
    data: {
      name: string;
      status: string;
      runSchedule: { start: number; end?: number };
      totalBudget?: { amount: string; currencyCode: string };
      dailyBudget?: { amount: string; currencyCode: string };
      objectiveType?: string;
    }
  ): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      `/rest/adAccounts/${accountId}/adCampaignGroups`,
      {
        method: "POST",
        body: {
          account: `urn:li:sponsoredAccount:${accountId}`,
          ...data,
        },
      }
    );
  }

  async updateCampaignGroup(
    accountId: string,
    campaignGroupId: string,
    updates: Record<string, unknown>
  ): Promise<void> {
    await this.request<void>(
      `/rest/adAccounts/${accountId}/adCampaignGroups/${campaignGroupId}`,
      {
        method: "POST",
        restliMethod: "PARTIAL_UPDATE",
        body: { patch: { $set: updates } },
      }
    );
  }

  async deleteCampaignGroup(
    accountId: string,
    campaignGroupId: string,
    isDraft: boolean
  ): Promise<void> {
    if (isDraft) {
      await this.request<void>(
        `/rest/adAccounts/${accountId}/adCampaignGroups/${campaignGroupId}`,
        { method: "DELETE" }
      );
    } else {
      await this.updateCampaignGroup(accountId, campaignGroupId, {
        status: "PENDING_DELETION",
      });
    }
  }

  // ==================== Campaign Write ====================

  async createCampaign(
    accountId: string,
    data: {
      name: string;
      campaignGroup: string;
      status: string;
      type: string;
      objectiveType: string;
      costType: string;
      dailyBudget?: { amount: string; currencyCode: string };
      totalBudget?: { amount: string; currencyCode: string };
      unitCost: { amount: string; currencyCode: string };
      locale: { country: string; language: string };
      targetingCriteria: unknown;
      runSchedule?: { start: number; end?: number };
      offsiteDeliveryEnabled?: boolean;
      audienceExpansionEnabled?: boolean;
      creativeSelection?: string;
      politicalIntent?: string;
    }
  ): Promise<{ id: string }> {
    const campaignGroupUrn = data.campaignGroup.startsWith("urn:")
      ? data.campaignGroup
      : `urn:li:sponsoredCampaignGroup:${data.campaignGroup}`;
    const { campaignGroup: _cg, ...rest } = data;
    return this.request<{ id: string }>(
      `/rest/adAccounts/${accountId}/adCampaigns`,
      {
        method: "POST",
        body: {
          account: `urn:li:sponsoredAccount:${accountId}`,
          campaignGroup: campaignGroupUrn,
          ...rest,
        },
      }
    );
  }

  async updateCampaign(
    accountId: string,
    campaignId: string,
    updates: Record<string, unknown>
  ): Promise<void> {
    await this.request<void>(
      `/rest/adAccounts/${accountId}/adCampaigns/${campaignId}`,
      {
        method: "POST",
        restliMethod: "PARTIAL_UPDATE",
        body: { patch: { $set: updates } },
      }
    );
  }

  async deleteCampaign(
    accountId: string,
    campaignId: string,
    isDraft: boolean
  ): Promise<void> {
    if (isDraft) {
      await this.request<void>(
        `/rest/adAccounts/${accountId}/adCampaigns/${campaignId}`,
        { method: "DELETE" }
      );
    } else {
      await this.updateCampaign(accountId, campaignId, {
        status: "PENDING_DELETION",
      });
    }
  }

  // ==================== Creative Write ====================

  async createCreative(
    accountId: string,
    data: {
      campaign: string;
      content?: unknown;
      intendedStatus: string;
      name?: string;
      leadgenCallToAction?: unknown;
    }
  ): Promise<{ id: string }> {
    const body: Record<string, unknown> = {
      campaign: data.campaign.startsWith("urn:")
        ? data.campaign
        : `urn:li:sponsoredCampaign:${data.campaign}`,
      intendedStatus: data.intendedStatus,
    };
    if (data.content) body.content = data.content;
    if (data.name) body.name = data.name;
    if (data.leadgenCallToAction)
      body.leadgenCallToAction = data.leadgenCallToAction;

    return this.request<{ id: string }>(
      `/rest/adAccounts/${accountId}/creatives`,
      { method: "POST", body }
    );
  }

  async createInlineCreative(
    accountId: string,
    data: {
      campaign: string;
      intendedStatus: string;
      name?: string;
      organizationId: string;
      commentary: string;
      mediaId?: string;
      mediaTitle?: string;
      landingPageUrl?: string;
      callToActionLabel?: string;
      leadgenCallToAction?: { destination: string; label: string };
    }
  ): Promise<{ id: string }> {
    const campaignUrn = data.campaign.startsWith("urn:")
      ? data.campaign
      : `urn:li:sponsoredCampaign:${data.campaign}`;
    const orgUrn = data.organizationId.startsWith("urn:")
      ? data.organizationId
      : `urn:li:organization:${data.organizationId}`;

    const post: Record<string, unknown> = {
      adContext: {
        dscAdAccount: `urn:li:sponsoredAccount:${accountId}`,
        dscStatus: "ACTIVE",
      },
      author: orgUrn,
      commentary: data.commentary,
      visibility: "PUBLIC",
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };

    if (data.mediaId) {
      post.content = {
        media: { id: data.mediaId, title: data.mediaTitle || "" },
      };
    }
    if (data.landingPageUrl) {
      post.contentLandingPage = data.landingPageUrl;
    }
    if (data.callToActionLabel) {
      post.contentCallToActionLabel = data.callToActionLabel;
    }

    const creative: Record<string, unknown> = {
      inlineContent: { post },
      campaign: campaignUrn,
      intendedStatus: data.intendedStatus,
    };

    if (data.name) creative.name = data.name;
    if (data.leadgenCallToAction)
      creative.leadgenCallToAction = data.leadgenCallToAction;

    return this.request<{ id: string }>(
      `/rest/adAccounts/${accountId}/creatives?action=createInline`,
      { method: "POST", body: { creative } }
    );
  }

  async updateCreative(
    accountId: string,
    creativeId: string,
    updates: Record<string, unknown>
  ): Promise<void> {
    const encodedId = encodeURIComponent(
      creativeId.startsWith("urn:")
        ? creativeId
        : `urn:li:sponsoredCreative:${creativeId}`
    );
    await this.request<void>(
      `/rest/adAccounts/${accountId}/creatives/${encodedId}`,
      {
        method: "POST",
        restliMethod: "PARTIAL_UPDATE",
        body: { patch: { $set: updates } },
      }
    );
  }
}
