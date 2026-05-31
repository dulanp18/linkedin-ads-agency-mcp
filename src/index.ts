import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LinkedInAdsClient } from "./linkedin-ads-client.js";
import type { Env, StandardMetrics, DemographicPivot } from "./types.js";

type State = Record<string, never>;
type Props = Record<string, unknown>;

// ==================== Helpers ====================

function calculateStandardMetrics(
  record: Record<string, unknown>,
  estimatedAudienceSize?: number
): StandardMetrics {
  const impressions = (record.impressions as number) || 0;
  const clicks = (record.clicks as number) || 0;
  const spend = parseFloat(record.costInUsd as string) || 0;
  const conversions = (record.externalWebsiteConversions as number) || 0;
  const engagements = (record.totalEngagements as number) || 0;
  const reach =
    (record.approximateUniqueImpressions as number) ||
    (impressions > 0 ? Math.round(impressions * 0.7) : 0);

  const nativeAudiencePenetration =
    record.audiencePenetration != null
      ? Number(
          Number((record.audiencePenetration as number) * 100).toFixed(2)
        )
      : null;
  const fallbackAudiencePenetration =
    estimatedAudienceSize && estimatedAudienceSize > 0
      ? Number(((reach / estimatedAudienceSize) * 100).toFixed(2))
      : null;

  return {
    spend,
    impressions,
    clicks,
    reach,
    frequency: reach > 0 ? Number((impressions / reach).toFixed(2)) : null,
    engagements,
    engagementRate:
      impressions > 0
        ? Number(((engagements / impressions) * 100).toFixed(2))
        : null,
    ctr:
      impressions > 0
        ? Number(((clicks / impressions) * 100).toFixed(2))
        : null,
    cpm:
      impressions > 0
        ? Number(((spend / impressions) * 1000).toFixed(2))
        : null,
    cpc: clicks > 0 ? Number((spend / clicks).toFixed(2)) : null,
    conversions,
    conversionRate:
      clicks > 0
        ? Number(((conversions / clicks) * 100).toFixed(2))
        : null,
    costPerConversion:
      conversions > 0 ? Number((spend / conversions).toFixed(2)) : null,
    audiencePenetration:
      nativeAudiencePenetration ?? fallbackAudiencePenetration,
    averageDwellTime:
      record.averageDwellTime != null
        ? Number(record.averageDwellTime)
        : null,
  };
}

function aggregateMetrics(
  records: Record<string, unknown>[]
): Record<string, number> {
  let dwellTimeSum = 0;
  let dwellTimeCount = 0;

  const initial = { impressions: 0, clicks: 0, costInUsd: 0, conversions: 0 };
  const totals = records.reduce(
    (acc: typeof initial, r) => {
      if (r.averageDwellTime != null) {
        dwellTimeSum += r.averageDwellTime as number;
        dwellTimeCount += 1;
      }
      return {
        impressions: acc.impressions + ((r.impressions as number) || 0),
        clicks: acc.clicks + ((r.clicks as number) || 0),
        costInUsd:
          acc.costInUsd + (parseFloat(r.costInUsd as string) || 0),
        conversions:
          acc.conversions +
          ((r.externalWebsiteConversions as number) || 0),
      };
    },
    initial
  );

  return {
    ...totals,
    averageDwellTime:
      dwellTimeCount > 0 ? dwellTimeSum / dwellTimeCount : 0,
  };
}

function calculatePercentageChange(
  oldVal: number,
  newVal: number
): number | null {
  if (oldVal === 0) return newVal > 0 ? 100 : null;
  return ((newVal - oldVal) / oldVal) * 100;
}

const DEMOGRAPHIC_TYPE_MAP: Record<DemographicPivot, string> = {
  MEMBER_JOB_FUNCTION: "Job Function",
  MEMBER_SENIORITY: "Seniority",
  MEMBER_INDUSTRY: "Industry",
  MEMBER_COMPANY_SIZE: "Company Size",
  MEMBER_JOB_TITLE: "Job Title",
  MEMBER_COMPANY: "Company",
  MEMBER_COUNTRY: "Country",
  MEMBER_COUNTRY_V2: "Country",
  MEMBER_REGION: "Region",
  MEMBER_REGION_V2: "Region",
};

// ==================== MCP Agent ====================

export class LinkedInAdsMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({
    name: "LinkedIn Ads Agency MCP",
    version: "1.0.0",
  });

  async init() {
    const client = new LinkedInAdsClient(this.env);

    // ==================== Account Management ====================

    this.server.tool(
      "list_accounts",
      "Lists all LinkedIn Ad Accounts the configured OAuth token has access to. Use this to discover which accounts are available and get their IDs for use with other tools.",
      {},
      async () => {
        try {
          const accounts = await client.listAdAccounts();
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  accounts.map((a) => ({
                    id: a.id,
                    name: a.name,
                    currency: a.currency,
                    type: a.type,
                    status: a.status,
                    servingStatuses: a.servingStatuses,
                    reference: a.reference,
                    isTest: a.test,
                  })),
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.tool(
      "get_account_details",
      "Retrieves detailed information about a LinkedIn Ad Account including status, currency, notification settings, and linked organization.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
      },
      async ({ accountId }) => {
        try {
          const account = await client.getAccountDetails(accountId);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    id: account.id,
                    name: account.name,
                    currency: account.currency,
                    type: account.type,
                    status: account.status,
                    servingStatuses: account.servingStatuses,
                    reference: account.reference,
                    notificationSettings: {
                      campaignOptimization:
                        account.notifiedOnCampaignOptimization,
                      creativeApproval:
                        account.notifiedOnCreativeApproval,
                      creativeRejection:
                        account.notifiedOnCreativeRejection,
                      endOfCampaign: account.notifiedOnEndOfCampaign,
                    },
                    isTest: account.test,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== Campaign Performance ====================

    this.server.tool(
      "get_campaign_performance",
      "Retrieves performance metrics for campaigns within a specified date range. Returns key metrics like impressions, clicks, spend, CTR, conversions, audience penetration, and average dwell time.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        campaignIds: z
          .array(z.string())
          .optional()
          .describe("Specific campaign IDs to filter"),
        campaignGroupIds: z
          .array(z.string())
          .optional()
          .describe("Filter by campaign group IDs"),
        startDate: z
          .string()
          .describe("Start date in YYYY-MM-DD format"),
        endDate: z
          .string()
          .optional()
          .describe("End date in YYYY-MM-DD format. Default: today"),
        timeGranularity: z
          .enum(["ALL", "DAILY", "MONTHLY"])
          .optional()
          .describe("Time granularity. Default: ALL"),
      },
      async ({
        accountId,
        campaignIds,
        campaignGroupIds,
        startDate,
        endDate,
        timeGranularity,
      }) => {
        try {
          const analytics = await client.getCampaignPerformance({
            accountId,
            campaignIds,
            campaignGroupIds,
            startDate,
            endDate,
            timeGranularity,
          });

          const ids = analytics
            .map(
              (r: Record<string, unknown>) =>
                ((r.pivotValues as string[])?.[0] || "").split(":").pop()
            )
            .filter((id): id is string => Boolean(id));

          const campaignMap = await client.getCampaignsByIds(
            accountId,
            ids
          );

          const results = analytics.map((record: Record<string, unknown>) => {
            const campaignUrn =
              (record.pivotValues as string[])?.[0] || "";
            const campaignId = campaignUrn.split(":").pop() || "";
            const campaign = campaignMap.get(campaignId);
            const standardMetrics = calculateStandardMetrics(record);

            return {
              campaignId,
              campaignName: campaign?.name || "Unknown",
              campaignGroupId:
                campaign?.campaignGroup?.split(":").pop() || null,
              status: campaign?.status || "Unknown",
              metrics: {
                ...standardMetrics,
                landingPageClicks:
                  (record.landingPageClicks as number) || 0,
                costInLocalCurrency:
                  parseFloat(record.costInLocalCurrency as string) || 0,
              },
            };
          });

          const totalRecord = results.reduce(
            (acc, r) => ({
              impressions: acc.impressions + r.metrics.impressions,
              clicks: acc.clicks + r.metrics.clicks,
              costInUsd: acc.costInUsd + r.metrics.spend,
              totalEngagements:
                acc.totalEngagements + r.metrics.engagements,
              externalWebsiteConversions:
                acc.externalWebsiteConversions + r.metrics.conversions,
              approximateUniqueImpressions:
                acc.approximateUniqueImpressions + r.metrics.reach,
            }),
            {
              impressions: 0,
              clicks: 0,
              costInUsd: 0,
              totalEngagements: 0,
              externalWebsiteConversions: 0,
              approximateUniqueImpressions: 0,
            }
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    campaigns: results,
                    totals: calculateStandardMetrics(totalRecord),
                    dateRange: {
                      start: startDate,
                      end:
                        endDate ||
                        new Date().toISOString().split("T")[0],
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== Creative Performance ====================

    this.server.tool(
      "get_creative_performance",
      "Retrieves performance metrics for individual ad creatives. Shows which specific ads are performing best, including engagement metrics (likes, comments, shares) and video metrics.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        campaignIds: z
          .array(z.string())
          .optional()
          .describe("Filter creatives by campaign IDs"),
        startDate: z
          .string()
          .describe("Start date in YYYY-MM-DD format"),
        endDate: z
          .string()
          .optional()
          .describe("End date in YYYY-MM-DD format. Default: today"),
        timeGranularity: z
          .enum(["ALL", "DAILY"])
          .optional()
          .describe("Time granularity. Default: ALL"),
        includeVideoMetrics: z
          .boolean()
          .optional()
          .describe("Include video-specific metrics. Default: true"),
      },
      async ({
        accountId,
        campaignIds,
        startDate,
        endDate,
        timeGranularity,
        includeVideoMetrics,
      }) => {
        try {
          const analytics = await client.getCreativePerformance({
            accountId,
            campaignIds,
            startDate,
            endDate,
            timeGranularity,
            includeVideoMetrics,
          });

          const creativeIds = analytics
            .map(
              (r: Record<string, unknown>) =>
                ((r.pivotValues as string[])?.[0] || "").split(":").pop()
            )
            .filter((id): id is string => Boolean(id));

          const creativeMap = await client.getCreativesByIds(
            accountId,
            creativeIds
          );

          const results = analytics.map((record: Record<string, unknown>) => {
            const creativeUrn =
              (record.pivotValues as string[])?.[0] || "";
            const creativeId = creativeUrn.split(":").pop() || "";
            const creative = creativeMap.get(creativeId);
            const standardMetrics = calculateStandardMetrics(record);

            return {
              creativeId,
              creativeName:
                creative?.name ||
                creative?.content?.textAd?.text?.substring(0, 50) ||
                `Creative ${creativeId}`,
              status: creative?.status || "Unknown",
              metrics: {
                ...standardMetrics,
                landingPageClicks:
                  (record.landingPageClicks as number) || 0,
                likes: (record.likes as number) || 0,
                comments: (record.comments as number) || 0,
                shares: (record.shares as number) || 0,
                reactions: (record.reactions as number) || 0,
                follows: (record.follows as number) || 0,
                videoViews: (record.videoViews as number) || 0,
                videoCompletions:
                  (record.videoCompletions as number) || 0,
                videoFirstQuartileCompletions:
                  (record.videoFirstQuartileCompletions as number) || 0,
                videoMidpointCompletions:
                  (record.videoMidpointCompletions as number) || 0,
                videoThirdQuartileCompletions:
                  (record.videoThirdQuartileCompletions as number) || 0,
                videoCompletionRate:
                  (record.videoViews as number) > 0
                    ? Number(
                        (
                          (((record.videoCompletions as number) || 0) /
                            (record.videoViews as number)) *
                          100
                        ).toFixed(2)
                      )
                    : null,
              },
            };
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    creatives: results,
                    dateRange: {
                      start: startDate,
                      end:
                        endDate ||
                        new Date().toISOString().split("T")[0],
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== Campaign Groups ====================

    this.server.tool(
      "get_campaign_groups",
      "Lists all campaign groups for an account with their configuration and optionally aggregated performance.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        status: z
          .array(
            z.enum(["ACTIVE", "PAUSED", "ARCHIVED", "DRAFT"])
          )
          .optional()
          .describe("Filter by status"),
        includePerformance: z
          .boolean()
          .optional()
          .describe("Include performance metrics. Default: true"),
        startDate: z
          .string()
          .optional()
          .describe("Start date for performance (if included)"),
        endDate: z
          .string()
          .optional()
          .describe("End date for performance (if included)"),
      },
      async ({
        accountId,
        status,
        includePerformance,
        startDate,
        endDate,
      }) => {
        try {
          const groups = await client.listCampaignGroups(accountId, {
            status,
          });

          const campaigns = await client.listCampaigns(accountId);
          const campaignCountByGroup = campaigns.reduce(
            (acc, c) => {
              const groupId =
                c.campaignGroup?.split(":").pop() || "";
              acc[groupId] = (acc[groupId] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          );

          let performanceByGroup: Record<string, StandardMetrics> = {};
          if (includePerformance !== false && startDate) {
            const analytics =
              await client.getCampaignGroupPerformance({
                accountId,
                startDate,
                endDate,
              });

            performanceByGroup = analytics.reduce(
              (acc, record: Record<string, unknown>) => {
                const groupUrn =
                  (record.pivotValues as string[])?.[0] || "";
                const groupId = groupUrn.split(":").pop() || "";
                acc[groupId] = calculateStandardMetrics(record);
                return acc;
              },
              {} as Record<string, StandardMetrics>
            );
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    campaignGroups: groups.map((group) => ({
                      id: group.id,
                      name: group.name,
                      status: group.status,
                      totalBudget: group.totalBudget,
                      runSchedule: group.runSchedule
                        ? {
                            start: group.runSchedule.start
                              ? new Date(
                                  group.runSchedule.start
                                ).toISOString()
                              : null,
                            end: group.runSchedule.end
                              ? new Date(
                                  group.runSchedule.end
                                ).toISOString()
                              : null,
                          }
                        : null,
                      campaignCount:
                        campaignCountByGroup[group.id] || 0,
                      performance:
                        performanceByGroup[group.id] || null,
                    })),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== Audience Demographics ====================

    this.server.tool(
      "get_audience_demographics",
      "Retrieves demographic breakdown of who saw or interacted with your ads. Shows performance segmented by job function, seniority, industry, company size, or geographic location.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        campaignIds: z
          .array(z.string())
          .optional()
          .describe("Filter by specific campaigns"),
        demographicType: z
          .enum([
            "MEMBER_JOB_FUNCTION",
            "MEMBER_SENIORITY",
            "MEMBER_INDUSTRY",
            "MEMBER_COMPANY_SIZE",
            "MEMBER_JOB_TITLE",
            "MEMBER_COMPANY",
            "MEMBER_COUNTRY",
            "MEMBER_COUNTRY_V2",
            "MEMBER_REGION",
            "MEMBER_REGION_V2",
          ])
          .describe("The demographic dimension to analyze"),
        startDate: z
          .string()
          .describe("Start date in YYYY-MM-DD format"),
        endDate: z
          .string()
          .optional()
          .describe("End date in YYYY-MM-DD format. Default: today"),
        metric: z
          .enum(["impressions", "clicks", "costInUsd"])
          .optional()
          .describe("Primary metric to sort by. Default: impressions"),
        limit: z
          .number()
          .optional()
          .describe("Top N results to return (max 100). Default: 25"),
      },
      async ({
        accountId,
        campaignIds,
        demographicType,
        startDate,
        endDate,
        metric,
        limit,
      }) => {
        try {
          const analytics = await client.getAudienceDemographics({
            accountId,
            demographicType,
            campaignIds,
            startDate,
            endDate,
          });

          const sortMetric = metric || "impressions";
          const resultLimit = Math.min(limit || 25, 100);

          const totalRecord = analytics.reduce(
            (acc, r: Record<string, unknown>) => ({
              impressions:
                acc.impressions + ((r.impressions as number) || 0),
              clicks: acc.clicks + ((r.clicks as number) || 0),
              costInUsd:
                acc.costInUsd +
                (parseFloat(r.costInUsd as string) || 0),
              totalEngagements:
                acc.totalEngagements +
                ((r.totalEngagements as number) || 0),
              externalWebsiteConversions:
                acc.externalWebsiteConversions +
                ((r.externalWebsiteConversions as number) || 0),
              approximateUniqueImpressions:
                acc.approximateUniqueImpressions +
                ((r.approximateUniqueImpressions as number) || 0),
            }),
            {
              impressions: 0,
              clicks: 0,
              costInUsd: 0,
              totalEngagements: 0,
              externalWebsiteConversions: 0,
              approximateUniqueImpressions: 0,
            }
          );

          let segments = analytics.map(
            (record: Record<string, unknown>) => {
              const urn =
                (record.pivotValues as string[])?.[0] || "";
              const name = urn.split(":").pop() || urn;
              const standardMetrics =
                calculateStandardMetrics(record);

              return {
                name,
                urn,
                metrics: standardMetrics,
                percentOfTotal:
                  totalRecord.impressions > 0
                    ? Number(
                        (
                          (((record.impressions as number) || 0) /
                            totalRecord.impressions) *
                          100
                        ).toFixed(2)
                      )
                    : 0,
              };
            }
          );

          segments.sort((a, b) => {
            const aVal =
              (a.metrics[
                sortMetric as keyof StandardMetrics
              ] as number) || 0;
            const bVal =
              (b.metrics[
                sortMetric as keyof StandardMetrics
              ] as number) || 0;
            return bVal - aVal;
          });

          segments = segments.slice(0, resultLimit);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    demographicType,
                    demographicTypeName:
                      DEMOGRAPHIC_TYPE_MAP[demographicType],
                    dateRange: {
                      start: startDate,
                      end:
                        endDate ||
                        new Date().toISOString().split("T")[0],
                    },
                    segments,
                    totals: calculateStandardMetrics(totalRecord),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== Audience Reach ====================

    this.server.tool(
      "get_audience_reach",
      "Shows unique member reach and audience penetration for campaigns. Date range must be 92 days or less.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        campaignIds: z
          .array(z.string())
          .optional()
          .describe("Filter by specific campaigns"),
        campaignGroupIds: z
          .array(z.string())
          .optional()
          .describe("Filter by campaign groups"),
        startDate: z
          .string()
          .describe("Start date in YYYY-MM-DD format (max 92 days range)"),
        endDate: z
          .string()
          .optional()
          .describe("End date in YYYY-MM-DD format. Default: today"),
      },
      async ({
        accountId,
        campaignIds,
        campaignGroupIds,
        startDate,
        endDate,
      }) => {
        try {
          const start = new Date(startDate);
          const end = endDate ? new Date(endDate) : new Date();
          const daysDiff = Math.ceil(
            (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
          );

          if (daysDiff > 92) {
            throw new Error(
              `Date range exceeds maximum of 92 days. Current range: ${daysDiff} days.`
            );
          }

          const analytics = await client.getAudienceReach({
            accountId,
            campaignIds,
            campaignGroupIds,
            startDate,
            endDate,
          });

          const results = analytics.map(
            (record: Record<string, unknown>) => {
              const entityUrn =
                (record.pivotValues as string[])?.[0] || "";
              const entityId = entityUrn.split(":").pop() || "";
              const entityType = entityUrn.includes("Campaign")
                ? "CAMPAIGN"
                : entityUrn.includes("CampaignGroup")
                  ? "CAMPAIGN_GROUP"
                  : "ACCOUNT";

              const reach =
                (record.approximateMemberReach as number) || 0;
              const impressions =
                (record.impressions as number) || 0;
              const audiencePenetration =
                record.audiencePenetration != null
                  ? Number(
                      Number(
                        (record.audiencePenetration as number) * 100
                      ).toFixed(2)
                    )
                  : null;

              return {
                entityType,
                entityId,
                metrics: {
                  approximateMemberReach: reach,
                  impressions,
                  frequency:
                    reach > 0
                      ? (impressions / reach).toFixed(2)
                      : null,
                  audiencePenetration,
                },
              };
            }
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    dateRange: {
                      start: startDate,
                      end:
                        endDate ||
                        new Date().toISOString().split("T")[0],
                    },
                    entities: results,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== Saved Audiences ====================

    this.server.tool(
      "list_saved_audiences",
      "Lists saved/matched audiences available in the account for targeting.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        status: z
          .array(z.enum(["ACTIVE", "EXPIRED", "PROCESSING"]))
          .optional()
          .describe("Filter by status"),
        audienceType: z
          .enum(["MATCHED", "LOOKALIKE", "PREDICTIVE"])
          .optional()
          .describe("Filter by audience type"),
      },
      async ({ accountId, status, audienceType }) => {
        try {
          const audiences = await client.listSavedAudiences(
            accountId,
            { status, type: audienceType }
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    audiences: audiences.map((a) => ({
                      id: a.id,
                      name: a.name,
                      type: a.type,
                      status: a.status,
                      memberCount: a.memberCount,
                      matchRate: a.matchRate,
                      createdAt: new Date(
                        a.createdAt
                      ).toISOString(),
                      lastModified: new Date(
                        a.lastModified
                      ).toISOString(),
                    })),
                    totalCount: audiences.length,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== Conversion Performance ====================

    this.server.tool(
      "get_conversion_performance",
      "Retrieves conversion metrics broken down by conversion type/action.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        campaignIds: z
          .array(z.string())
          .optional()
          .describe("Filter by specific campaigns"),
        startDate: z
          .string()
          .describe("Start date in YYYY-MM-DD format"),
        endDate: z
          .string()
          .optional()
          .describe("End date in YYYY-MM-DD format. Default: today"),
        includePostView: z
          .boolean()
          .optional()
          .describe(
            "Include view-through conversions. Default: true"
          ),
        timeGranularity: z
          .enum(["ALL", "DAILY"])
          .optional()
          .describe("Time granularity. Default: ALL"),
      },
      async ({
        accountId,
        campaignIds,
        startDate,
        endDate,
        includePostView,
        timeGranularity,
      }) => {
        try {
          const analytics = await client.getConversionPerformance({
            accountId,
            campaignIds,
            startDate,
            endDate,
            includePostView,
            timeGranularity,
          });

          const conversionDefs = await client.listConversions(
            accountId
          );
          const conversionMap = new Map(
            conversionDefs.map((c) => [c.id, c])
          );

          const results = analytics.map(
            (record: Record<string, unknown>) => {
              const conversionUrn =
                (record.pivotValues as string[])?.[0] || "";
              const conversionId =
                conversionUrn.split(":").pop() || "";
              const conversionDef =
                conversionMap.get(conversionId);

              const totalConversions =
                (record.externalWebsiteConversions as number) || 0;
              const postClickConversions =
                (record.externalWebsitePostClickConversions as number) ||
                0;
              const postViewConversions =
                (record.externalWebsitePostViewConversions as number) ||
                0;
              const cost =
                parseFloat(record.costInUsd as string) || 0;
              const conversionValue =
                parseFloat(
                  record.conversionValueInLocalCurrency as string
                ) || 0;

              return {
                conversionId,
                conversionName:
                  conversionDef?.name || "Unknown",
                conversionType:
                  conversionDef?.type || "Unknown",
                metrics: {
                  totalConversions,
                  postClickConversions,
                  postViewConversions,
                  conversionValue,
                  costPerConversion:
                    totalConversions > 0
                      ? cost / totalConversions
                      : null,
                },
              };
            }
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    dateRange: {
                      start: startDate,
                      end:
                        endDate ||
                        new Date().toISOString().split("T")[0],
                    },
                    conversions: results,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== List Conversions ====================

    this.server.tool(
      "list_conversions",
      "Lists all conversion tracking rules configured for an account.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        enabledOnly: z
          .boolean()
          .optional()
          .describe("Only show enabled conversions. Default: false"),
      },
      async ({ accountId, enabledOnly }) => {
        try {
          const conversions = await client.listConversions(
            accountId,
            enabledOnly
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    conversions: conversions.map((c) => ({
                      id: c.id,
                      name: c.name,
                      type: c.type,
                      conversionMethod:
                        c.conversionMethod || "INSIGHT_TAG",
                      enabled: c.enabled,
                      postClickAttributionWindow:
                        c.postClickAttributionWindowSize,
                      viewThroughAttributionWindow:
                        c.viewThroughAttributionWindowSize,
                      attributionType: c.attributionType,
                    })),
                    totalCount: conversions.length,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== Lead Gen Performance ====================

    this.server.tool(
      "get_lead_gen_performance",
      "Retrieves lead generation form performance including form submissions, qualified leads, and cost per lead.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        campaignIds: z
          .array(z.string())
          .optional()
          .describe("Filter by specific campaigns"),
        startDate: z
          .string()
          .describe("Start date in YYYY-MM-DD format"),
        endDate: z
          .string()
          .optional()
          .describe("End date in YYYY-MM-DD format. Default: today"),
        timeGranularity: z
          .enum(["ALL", "DAILY"])
          .optional()
          .describe("Time granularity. Default: ALL"),
      },
      async ({
        accountId,
        campaignIds,
        startDate,
        endDate,
        timeGranularity,
      }) => {
        try {
          const analytics = await client.getLeadGenPerformance({
            accountId,
            campaignIds,
            startDate,
            endDate,
            timeGranularity,
          });

          const ids = analytics
            .map(
              (r: Record<string, unknown>) =>
                ((r.pivotValues as string[])?.[0] || "")
                  .split(":")
                  .pop()
            )
            .filter((id): id is string => Boolean(id));

          const campaignMap = await client.getCampaignsByIds(
            accountId,
            ids
          );

          const results = analytics.map(
            (record: Record<string, unknown>) => {
              const campaignUrn =
                (record.pivotValues as string[])?.[0] || "";
              const campaignId =
                campaignUrn.split(":").pop() || "";
              const campaign = campaignMap.get(campaignId);

              const leads =
                (record.oneClickLeads as number) || 0;
              const formOpens =
                (record.oneClickLeadFormOpens as number) || 0;
              const qualifiedLeads =
                (record.qualifiedLeads as number) || 0;
              const cost =
                parseFloat(record.costInUsd as string) || 0;

              return {
                campaignId,
                campaignName: campaign?.name || "Unknown",
                metrics: {
                  oneClickLeads: leads,
                  oneClickLeadFormOpens: formOpens,
                  qualifiedLeads,
                  costPerLead:
                    leads > 0 ? cost / leads : null,
                  costPerQualifiedLead:
                    qualifiedLeads > 0
                      ? cost / qualifiedLeads
                      : null,
                  formOpenToSubmitRate:
                    formOpens > 0
                      ? ((leads / formOpens) * 100).toFixed(2)
                      : null,
                },
              };
            }
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    dateRange: {
                      start: startDate,
                      end:
                        endDate ||
                        new Date().toISOString().split("T")[0],
                    },
                    byCampaign: results,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== List Lead Forms ====================

    this.server.tool(
      "list_lead_forms",
      "Lists all lead generation forms configured for an account.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        status: z
          .array(z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]))
          .optional()
          .describe("Filter by status"),
        includeQuestions: z
          .boolean()
          .optional()
          .describe("Include form questions. Default: true"),
      },
      async ({ accountId, status, includeQuestions }) => {
        try {
          const forms = await client.listLeadForms(
            accountId,
            status
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    forms: forms.map((form) => {
                      const result: Record<string, unknown> = {
                        id: form.id,
                        name: form.name,
                        status: form.status,
                        headline: form.headline,
                        description: form.description,
                        thankYouMessage: form.thankYouMessage,
                        landingPageUrl: form.landingPageUrl,
                      };
                      if (
                        includeQuestions !== false &&
                        form.questions
                      ) {
                        result.questions = form.questions;
                      }
                      return result;
                    }),
                    totalCount: forms.length,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== Compare Performance ====================

    this.server.tool(
      "compare_performance",
      "Compares performance between two time periods, campaigns, or campaign groups. Calculates percentage changes and highlights significant differences.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        comparisonType: z
          .enum(["TIME_PERIOD", "CAMPAIGNS", "CAMPAIGN_GROUPS"])
          .describe("Type of comparison to make"),
        periodA: z
          .object({
            startDate: z.string().optional(),
            endDate: z.string().optional(),
            entityIds: z.array(z.string()).optional(),
          })
          .describe("First period or entity set for comparison"),
        periodB: z
          .object({
            startDate: z.string().optional(),
            endDate: z.string().optional(),
            entityIds: z.array(z.string()).optional(),
          })
          .describe("Second period or entity set for comparison"),
      },
      async ({ accountId, comparisonType, periodA, periodB }) => {
        try {
          let metricsA: Record<string, number>;
          let metricsB: Record<string, number>;
          let labelA: string;
          let labelB: string;

          if (comparisonType === "TIME_PERIOD") {
            if (!periodA.startDate || !periodB.startDate) {
              throw new Error(
                "startDate is required for both periods"
              );
            }

            const [analyticsA, analyticsB] = await Promise.all([
              client.getAnalytics({
                accountId,
                pivot: "ACCOUNT",
                startDate: periodA.startDate,
                endDate: periodA.endDate,
                timeGranularity: "ALL",
              }),
              client.getAnalytics({
                accountId,
                pivot: "ACCOUNT",
                startDate: periodB.startDate,
                endDate: periodB.endDate,
                timeGranularity: "ALL",
              }),
            ]);

            metricsA = aggregateMetrics(
              analyticsA as Record<string, unknown>[]
            );
            metricsB = aggregateMetrics(
              analyticsB as Record<string, unknown>[]
            );
            labelA = `${periodA.startDate} - ${periodA.endDate || "Today"}`;
            labelB = `${periodB.startDate} - ${periodB.endDate || "Today"}`;
          } else if (comparisonType === "CAMPAIGNS") {
            if (
              !periodA.entityIds?.length ||
              !periodB.entityIds?.length
            ) {
              throw new Error(
                "entityIds required for both periods"
              );
            }

            const startDate =
              periodA.startDate || getDefaultStartDate();

            const [analyticsA, analyticsB] = await Promise.all([
              client.getCampaignPerformance({
                accountId,
                campaignIds: periodA.entityIds,
                startDate,
                endDate: periodA.endDate,
              }),
              client.getCampaignPerformance({
                accountId,
                campaignIds: periodB.entityIds,
                startDate,
                endDate: periodB.endDate,
              }),
            ]);

            metricsA = aggregateMetrics(
              analyticsA as Record<string, unknown>[]
            );
            metricsB = aggregateMetrics(
              analyticsB as Record<string, unknown>[]
            );
            labelA = `Campaigns: ${periodA.entityIds.join(", ")}`;
            labelB = `Campaigns: ${periodB.entityIds.join(", ")}`;
          } else {
            if (
              !periodA.entityIds?.length ||
              !periodB.entityIds?.length
            ) {
              throw new Error(
                "entityIds required for both periods"
              );
            }

            const startDate =
              periodA.startDate || getDefaultStartDate();

            const [analyticsA, analyticsB] = await Promise.all([
              client.getCampaignPerformance({
                accountId,
                campaignGroupIds: periodA.entityIds,
                startDate,
                endDate: periodA.endDate,
              }),
              client.getCampaignPerformance({
                accountId,
                campaignGroupIds: periodB.entityIds,
                startDate,
                endDate: periodB.endDate,
              }),
            ]);

            metricsA = aggregateMetrics(
              analyticsA as Record<string, unknown>[]
            );
            metricsB = aggregateMetrics(
              analyticsB as Record<string, unknown>[]
            );
            labelA = `Campaign Groups: ${periodA.entityIds.join(", ")}`;
            labelB = `Campaign Groups: ${periodB.entityIds.join(", ")}`;
          }

          const changes: Record<
            string,
            { absolute: number; percentage: number | null }
          > = {};
          const metricKeys = [
            "impressions",
            "clicks",
            "costInUsd",
            "conversions",
            "averageDwellTime",
          ];

          for (const key of metricKeys) {
            const valA = metricsA[key] || 0;
            const valB = metricsB[key] || 0;
            changes[key] = {
              absolute: valB - valA,
              percentage: calculatePercentageChange(valA, valB),
            };
          }

          const ctrA =
            metricsA.impressions > 0
              ? (metricsA.clicks / metricsA.impressions) * 100
              : 0;
          const ctrB =
            metricsB.impressions > 0
              ? (metricsB.clicks / metricsB.impressions) * 100
              : 0;
          changes["ctr"] = {
            absolute: ctrB - ctrA,
            percentage: calculatePercentageChange(ctrA, ctrB),
          };

          const cpcA =
            metricsA.clicks > 0
              ? metricsA.costInUsd / metricsA.clicks
              : 0;
          const cpcB =
            metricsB.clicks > 0
              ? metricsB.costInUsd / metricsB.clicks
              : 0;
          changes["costPerClick"] = {
            absolute: cpcB - cpcA,
            percentage: calculatePercentageChange(cpcA, cpcB),
          };

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    comparisonType,
                    periodA: { label: labelA, metrics: metricsA },
                    periodB: { label: labelB, metrics: metricsB },
                    changes,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== Daily Trends ====================

    this.server.tool(
      "get_daily_trends",
      "Retrieves daily performance trends over a specified period. Returns time-series data for visualizing performance patterns.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        campaignIds: z
          .array(z.string())
          .optional()
          .describe("Filter by specific campaigns"),
        startDate: z
          .string()
          .describe("Start date in YYYY-MM-DD format"),
        endDate: z
          .string()
          .optional()
          .describe("End date in YYYY-MM-DD format. Default: today"),
        entityLevel: z
          .enum(["ACCOUNT", "CAMPAIGN_GROUP", "CAMPAIGN"])
          .optional()
          .describe("Level of aggregation. Default: ACCOUNT"),
      },
      async ({
        accountId,
        campaignIds,
        startDate,
        endDate,
        entityLevel,
      }) => {
        try {
          const pivot =
            entityLevel === "CAMPAIGN"
              ? "CAMPAIGN"
              : entityLevel === "CAMPAIGN_GROUP"
                ? "CAMPAIGN_GROUP"
                : "ACCOUNT";

          const analytics = await client.getAnalytics({
            accountId,
            pivot: pivot as "ACCOUNT" | "CAMPAIGN" | "CAMPAIGN_GROUP",
            startDate,
            endDate,
            timeGranularity: "DAILY",
            campaigns: campaignIds,
          });

          const byDate = new Map<
            string,
            Record<string, number>
          >();

          for (const record of analytics as Record<
            string,
            unknown
          >[]) {
            const dr = record.dateRange as {
              start: {
                year: number;
                month: number;
                day: number;
              };
            };
            if (dr) {
              const date = `${dr.start.year}-${String(dr.start.month).padStart(2, "0")}-${String(dr.start.day).padStart(2, "0")}`;

              if (!byDate.has(date)) {
                byDate.set(date, {
                  impressions: 0,
                  clicks: 0,
                  costInUsd: 0,
                  conversions: 0,
                });
              }

              const metrics = byDate.get(date)!;
              metrics.impressions +=
                (record.impressions as number) || 0;
              metrics.clicks +=
                (record.clicks as number) || 0;
              metrics.costInUsd +=
                parseFloat(record.costInUsd as string) || 0;
              metrics.conversions +=
                (record.externalWebsiteConversions as number) || 0;
            }
          }

          const dataPoints = Array.from(byDate.entries())
            .map(([date, metrics]) => ({
              date,
              metrics: {
                impressions: metrics.impressions,
                clicks: metrics.clicks,
                costInUsd: Number(metrics.costInUsd.toFixed(2)),
                conversions: metrics.conversions,
                ctr:
                  metrics.impressions > 0
                    ? Number(
                        (
                          (metrics.clicks / metrics.impressions) *
                          100
                        ).toFixed(2)
                      )
                    : 0,
                costPerConversion:
                  metrics.conversions > 0
                    ? Number(
                        (
                          metrics.costInUsd / metrics.conversions
                        ).toFixed(2)
                      )
                    : null,
              },
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    dateRange: {
                      start: startDate,
                      end:
                        endDate ||
                        new Date().toISOString().split("T")[0],
                    },
                    granularity: "DAILY",
                    dataPoints,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== List Campaigns ====================

    this.server.tool(
      "list_campaigns",
      "Lists campaigns for a LinkedIn Ad Account. Returns ALL campaigns including DRAFT and PAUSED with zero impressions. Supports filtering by campaign group and status.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        campaignGroupIds: z
          .array(z.string())
          .optional()
          .describe("Filter by campaign group IDs"),
        status: z
          .array(
            z.enum([
              "ACTIVE",
              "PAUSED",
              "ARCHIVED",
              "DRAFT",
              "CANCELED",
            ])
          )
          .optional()
          .describe("Filter by campaign status"),
      },
      async ({ accountId, campaignGroupIds, status }) => {
        try {
          const campaigns = await client.listCampaigns(accountId, {
            campaignGroupIds,
            status,
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    campaigns: campaigns.map((c) => ({
                      id: c.id,
                      name: c.name,
                      status: c.status,
                      type: c.type,
                      objectiveType: c.objectiveType,
                      costType: c.costType,
                      campaignGroup: c.campaignGroup,
                      dailyBudget: c.dailyBudget,
                      totalBudget: c.totalBudget,
                      runSchedule: c.runSchedule,
                    })),
                    totalCount: campaigns.length,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== Campaign Group Write ====================

    this.server.tool(
      "create_campaign_group",
      "Creates a new LinkedIn campaign group for organizing campaigns.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        name: z
          .string()
          .describe("Name of the campaign group (max 100 characters)"),
        status: z
          .enum(["ACTIVE", "DRAFT"])
          .optional()
          .describe("Initial status. Default: DRAFT"),
        startDate: z
          .string()
          .describe("Start date in YYYY-MM-DD format"),
        endDate: z
          .string()
          .optional()
          .describe("End date in YYYY-MM-DD format"),
        totalBudgetAmount: z
          .string()
          .optional()
          .describe('Total budget amount (e.g., "5000.00")'),
        totalBudgetCurrency: z
          .string()
          .optional()
          .describe("Budget currency code (e.g., USD)"),
        dailyBudgetAmount: z
          .string()
          .optional()
          .describe("Daily budget amount"),
        dailyBudgetCurrency: z
          .string()
          .optional()
          .describe("Daily budget currency code"),
        objectiveType: z
          .enum([
            "BRAND_AWARENESS",
            "ENGAGEMENT",
            "JOB_APPLICANTS",
            "LEAD_GENERATION",
            "WEBSITE_CONVERSIONS",
            "WEBSITE_VISIT",
            "VIDEO_VIEWS",
          ])
          .optional()
          .describe("Campaign group objective type"),
      },
      async ({
        accountId,
        name,
        status,
        startDate,
        endDate,
        totalBudgetAmount,
        totalBudgetCurrency,
        dailyBudgetAmount,
        dailyBudgetCurrency,
        objectiveType,
      }) => {
        try {
          const data: Parameters<
            typeof client.createCampaignGroup
          >[1] = {
            name,
            status: status || "DRAFT",
            runSchedule: {
              start: new Date(startDate).getTime(),
              end: endDate
                ? new Date(endDate).getTime()
                : undefined,
            },
          };

          if (totalBudgetAmount) {
            data.totalBudget = {
              amount: totalBudgetAmount,
              currencyCode: totalBudgetCurrency || "USD",
            };
          }
          if (dailyBudgetAmount) {
            data.dailyBudget = {
              amount: dailyBudgetAmount,
              currencyCode: dailyBudgetCurrency || "USD",
            };
          }
          if (objectiveType) {
            data.objectiveType = objectiveType;
          }

          const result = await client.createCampaignGroup(
            accountId,
            data
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    campaignGroupId: result.id,
                    name,
                    status: status || "DRAFT",
                    message: `Campaign group "${name}" created successfully`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.tool(
      "update_campaign_group",
      "Updates an existing LinkedIn campaign group. Can change status, budget, name, or end date.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        campaignGroupId: z
          .string()
          .describe("The campaign group ID to update"),
        name: z
          .string()
          .optional()
          .describe("New name for the campaign group"),
        status: z
          .enum(["ACTIVE", "PAUSED", "ARCHIVED", "DRAFT"])
          .optional()
          .describe("New status"),
        totalBudgetAmount: z
          .string()
          .optional()
          .describe("New total budget amount"),
        totalBudgetCurrency: z
          .string()
          .optional()
          .describe("Budget currency code"),
        endDate: z
          .number()
          .optional()
          .describe(
            "New end date as Unix timestamp in milliseconds"
          ),
      },
      async ({
        accountId,
        campaignGroupId,
        name,
        status,
        totalBudgetAmount,
        totalBudgetCurrency,
        endDate,
      }) => {
        try {
          const updates: Record<string, unknown> = {};
          if (name) updates.name = name;
          if (status) updates.status = status;
          if (totalBudgetAmount) {
            updates.totalBudget = {
              amount: totalBudgetAmount,
              currencyCode: totalBudgetCurrency || "USD",
            };
          }
          if (endDate) {
            updates.runSchedule = { end: endDate };
          }

          if (Object.keys(updates).length === 0) {
            throw new Error("At least one field to update must be provided");
          }

          await client.updateCampaignGroup(
            accountId,
            campaignGroupId,
            updates
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    campaignGroupId,
                    updatedFields: Object.keys(updates),
                    message: `Campaign group ${campaignGroupId} updated successfully`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.tool(
      "delete_campaign_group",
      "Deletes a LinkedIn campaign group. Draft groups are deleted immediately. Non-draft groups are set to PENDING_DELETION.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        campaignGroupId: z
          .string()
          .describe("The campaign group ID to delete"),
      },
      async ({ accountId, campaignGroupId }) => {
        try {
          const groups = await client.listCampaignGroups(
            accountId,
            {}
          );
          const group = groups.find(
            (g) => String(g.id) === String(campaignGroupId)
          );
          const isDraft = group?.status === "DRAFT";

          await client.deleteCampaignGroup(
            accountId,
            campaignGroupId,
            isDraft
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    campaignGroupId,
                    action: isDraft
                      ? "DELETED"
                      : "PENDING_DELETION",
                    message: isDraft
                      ? `Draft campaign group ${campaignGroupId} deleted`
                      : `Campaign group ${campaignGroupId} set to PENDING_DELETION`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== Campaign Write ====================

    this.server.tool(
      "create_campaign",
      "Creates a new LinkedIn ad campaign within a campaign group. Requires targeting criteria, budget, and objective type.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        name: z.string().describe("Campaign name"),
        campaignGroupId: z
          .string()
          .describe("Campaign group ID to place this campaign under"),
        objectiveType: z
          .enum([
            "BRAND_AWARENESS",
            "ENGAGEMENT",
            "JOB_APPLICANTS",
            "LEAD_GENERATION",
            "WEBSITE_CONVERSIONS",
            "WEBSITE_VISIT",
            "VIDEO_VIEWS",
          ])
          .describe("Campaign objective type"),
        type: z
          .enum([
            "TEXT_AD",
            "SPONSORED_UPDATES",
            "SPONSORED_INMAILS",
            "DYNAMIC",
          ])
          .optional()
          .describe("Campaign type. Default: SPONSORED_UPDATES"),
        costType: z
          .enum(["CPM", "CPC", "CPV"])
          .optional()
          .describe("Cost/bid type. Default: CPM"),
        status: z
          .enum(["ACTIVE", "DRAFT"])
          .optional()
          .describe("Initial status. Default: DRAFT"),
        dailyBudgetAmount: z
          .string()
          .describe('Daily budget amount (e.g., "50.00")'),
        dailyBudgetCurrency: z
          .string()
          .optional()
          .describe("Currency code. Default: USD"),
        totalBudgetAmount: z
          .string()
          .optional()
          .describe("Total/lifetime budget amount"),
        totalBudgetCurrency: z
          .string()
          .optional()
          .describe("Currency code. Default: USD"),
        unitCostAmount: z
          .string()
          .describe('Bid amount per unit (e.g., "5.00")'),
        unitCostCurrency: z
          .string()
          .optional()
          .describe("Currency code. Default: USD"),
        localeCountry: z
          .string()
          .optional()
          .describe("Target country code. Default: US"),
        localeLanguage: z
          .string()
          .optional()
          .describe("Target language code. Default: en"),
        startDate: z
          .string()
          .optional()
          .describe("Start date in YYYY-MM-DD format"),
        endDate: z
          .string()
          .optional()
          .describe("End date in YYYY-MM-DD format"),
        targetingCriteria: z
          .record(z.unknown())
          .describe("Targeting criteria object with include/exclude conditions"),
        offsiteDeliveryEnabled: z
          .boolean()
          .optional()
          .describe("Enable LinkedIn Audience Network. Default: false"),
        audienceExpansionEnabled: z
          .boolean()
          .optional()
          .describe("Enable audience expansion. Default: false"),
        creativeSelection: z
          .enum(["OPTIMIZED", "ROUND_ROBIN"])
          .optional()
          .describe("Creative rotation strategy. Default: OPTIMIZED"),
        politicalIntent: z
          .enum(["POLITICAL", "NOT_POLITICAL", "NOT_DECLARED"])
          .optional()
          .describe("Political advertising intent. Default: NOT_POLITICAL"),
      },
      async (input) => {
        try {
          const currency = input.dailyBudgetCurrency || "USD";
          const data: Parameters<typeof client.createCampaign>[1] = {
            name: input.name,
            campaignGroup: input.campaignGroupId,
            status: input.status || "DRAFT",
            type: input.type || "SPONSORED_UPDATES",
            objectiveType: input.objectiveType,
            costType: input.costType || "CPM",
            dailyBudget: {
              amount: input.dailyBudgetAmount,
              currencyCode: currency,
            },
            unitCost: {
              amount: input.unitCostAmount,
              currencyCode: input.unitCostCurrency || currency,
            },
            locale: {
              country: input.localeCountry || "US",
              language: input.localeLanguage || "en",
            },
            targetingCriteria: input.targetingCriteria,
            offsiteDeliveryEnabled:
              input.offsiteDeliveryEnabled ?? false,
            audienceExpansionEnabled:
              input.audienceExpansionEnabled ?? false,
            creativeSelection:
              input.creativeSelection || "OPTIMIZED",
            politicalIntent:
              input.politicalIntent || "NOT_POLITICAL",
          };

          if (input.totalBudgetAmount) {
            data.totalBudget = {
              amount: input.totalBudgetAmount,
              currencyCode:
                input.totalBudgetCurrency || currency,
            };
          }
          if (input.startDate || input.endDate) {
            data.runSchedule = {
              start: input.startDate
                ? new Date(input.startDate).getTime()
                : Date.now(),
              end: input.endDate
                ? new Date(input.endDate).getTime()
                : undefined,
            };
          }

          const result = await client.createCampaign(
            input.accountId,
            data
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    campaignId: result.id,
                    name: input.name,
                    status: input.status || "DRAFT",
                    message: `Campaign "${input.name}" created successfully`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.tool(
      "update_campaign",
      "Updates an existing LinkedIn campaign. Can change status, budget, name, targeting, bid amount, and other settings.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        campaignId: z
          .string()
          .describe("The campaign ID to update"),
        name: z
          .string()
          .optional()
          .describe("New campaign name"),
        status: z
          .enum(["ACTIVE", "PAUSED", "ARCHIVED", "DRAFT"])
          .optional()
          .describe("New status"),
        dailyBudgetAmount: z
          .string()
          .optional()
          .describe("New daily budget amount"),
        dailyBudgetCurrency: z
          .string()
          .optional()
          .describe("Budget currency code"),
        totalBudgetAmount: z
          .string()
          .optional()
          .describe("New total/lifetime budget amount"),
        totalBudgetCurrency: z
          .string()
          .optional()
          .describe("Budget currency code"),
        unitCostAmount: z
          .string()
          .optional()
          .describe("New bid amount per unit"),
        unitCostCurrency: z
          .string()
          .optional()
          .describe("Bid currency code"),
        endDate: z
          .number()
          .optional()
          .describe(
            "New end date as Unix timestamp in milliseconds"
          ),
        targetingCriteria: z
          .record(z.unknown())
          .optional()
          .describe("New targeting criteria object"),
        offsiteDeliveryEnabled: z
          .boolean()
          .optional()
          .describe("Enable/disable LinkedIn Audience Network"),
        audienceExpansionEnabled: z
          .boolean()
          .optional()
          .describe("Enable/disable audience expansion"),
      },
      async (input) => {
        try {
          const updates: Record<string, unknown> = {};
          if (input.name) updates.name = input.name;
          if (input.status) updates.status = input.status;
          if (input.dailyBudgetAmount) {
            updates.dailyBudget = {
              amount: input.dailyBudgetAmount,
              currencyCode:
                input.dailyBudgetCurrency || "USD",
            };
          }
          if (input.totalBudgetAmount) {
            updates.totalBudget = {
              amount: input.totalBudgetAmount,
              currencyCode:
                input.totalBudgetCurrency || "USD",
            };
          }
          if (input.unitCostAmount) {
            updates.unitCost = {
              amount: input.unitCostAmount,
              currencyCode: input.unitCostCurrency || "USD",
            };
          }
          if (input.endDate) {
            updates.runSchedule = { end: input.endDate };
          }
          if (input.targetingCriteria) {
            updates.targetingCriteria =
              input.targetingCriteria;
          }
          if (input.offsiteDeliveryEnabled !== undefined) {
            updates.offsiteDeliveryEnabled =
              input.offsiteDeliveryEnabled;
          }
          if (input.audienceExpansionEnabled !== undefined) {
            updates.audienceExpansionEnabled =
              input.audienceExpansionEnabled;
          }

          if (Object.keys(updates).length === 0) {
            throw new Error(
              "At least one field to update must be provided"
            );
          }

          await client.updateCampaign(
            input.accountId,
            input.campaignId,
            updates
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    campaignId: input.campaignId,
                    updatedFields: Object.keys(updates),
                    message: `Campaign ${input.campaignId} updated successfully`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.tool(
      "delete_campaign",
      "Deletes a LinkedIn campaign. Draft campaigns are deleted immediately. Non-draft campaigns are set to PENDING_DELETION.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        campaignId: z
          .string()
          .describe("The campaign ID to delete"),
      },
      async ({ accountId, campaignId }) => {
        try {
          const campaign = await client.getCampaign(
            accountId,
            campaignId
          );
          const isDraft = campaign?.status === "DRAFT";

          await client.deleteCampaign(
            accountId,
            campaignId,
            isDraft
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    campaignId,
                    action: isDraft
                      ? "DELETED"
                      : "PENDING_DELETION",
                    message: isDraft
                      ? `Draft campaign ${campaignId} deleted`
                      : `Campaign ${campaignId} set to PENDING_DELETION`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // ==================== Creative Write ====================

    this.server.tool(
      "update_creative_status",
      "Updates the intended status of a LinkedIn creative/ad. Can activate, pause, or archive creatives.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        creativeId: z
          .string()
          .describe("The creative ID (numeric ID or full URN)"),
        intendedStatus: z
          .enum(["ACTIVE", "PAUSED", "ARCHIVED"])
          .describe("New intended status for the creative"),
      },
      async ({ accountId, creativeId, intendedStatus }) => {
        try {
          await client.updateCreative(accountId, creativeId, {
            intendedStatus,
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    creativeId,
                    intendedStatus,
                    message: `Creative ${creativeId} status updated to ${intendedStatus}`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.tool(
      "create_creative",
      "Creates a new LinkedIn creative/ad under a campaign. Requires a content reference (post/share URN).",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        campaignId: z
          .string()
          .describe("Campaign ID to create the creative under"),
        contentReference: z
          .string()
          .describe(
            "URN of the content to sponsor (e.g., urn:li:share:123)"
          ),
        intendedStatus: z
          .enum(["ACTIVE", "DRAFT"])
          .optional()
          .describe("Initial status. Default: DRAFT"),
        name: z
          .string()
          .optional()
          .describe("Optional name for the creative"),
        leadgenFormId: z
          .string()
          .optional()
          .describe("Lead gen form ID for LEAD_GENERATION campaigns"),
        leadgenCallToActionLabel: z
          .enum([
            "APPLY",
            "DOWNLOAD",
            "VIEW_QUOTE",
            "LEARN_MORE",
            "SIGN_UP",
            "SUBSCRIBE",
            "REGISTER",
            "REQUEST_DEMO",
            "JOIN",
            "ATTEND",
          ])
          .optional()
          .describe("Call to action label for lead gen campaigns"),
      },
      async ({
        accountId,
        campaignId,
        contentReference,
        intendedStatus,
        name,
        leadgenFormId,
        leadgenCallToActionLabel,
      }) => {
        try {
          const data: Parameters<typeof client.createCreative>[1] =
            {
              campaign: campaignId,
              content: { reference: contentReference },
              intendedStatus: intendedStatus || "DRAFT",
            };

          if (name) data.name = name;
          if (leadgenFormId) {
            data.leadgenCallToAction = {
              destination: leadgenFormId.startsWith("urn:")
                ? leadgenFormId
                : `urn:li:adForm:${leadgenFormId}`,
              label: leadgenCallToActionLabel || "LEARN_MORE",
            };
          }

          const result = await client.createCreative(
            accountId,
            data
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    creativeId: result.id,
                    campaignId,
                    intendedStatus:
                      intendedStatus || "DRAFT",
                    message: `Creative created successfully under campaign ${campaignId}`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.tool(
      "create_inline_ad",
      "Creates a new LinkedIn ad with inline content directly (without needing a pre-existing post). Creates the ad content and the creative in a single call.",
      {
        accountId: z.string().describe("The LinkedIn Ad Account ID"),
        campaignId: z
          .string()
          .describe("Campaign ID to create the ad under"),
        organizationId: z
          .string()
          .describe("Organization/company ID that will be the ad author"),
        commentary: z
          .string()
          .describe("The ad text/copy that appears as the post commentary"),
        mediaId: z
          .string()
          .optional()
          .describe("URN of the image or video to use"),
        mediaTitle: z
          .string()
          .optional()
          .describe("Title for the media"),
        landingPageUrl: z
          .string()
          .optional()
          .describe("Landing page URL for the ad"),
        callToActionLabel: z
          .enum([
            "APPLY",
            "DOWNLOAD",
            "VIEW_QUOTE",
            "LEARN_MORE",
            "SIGN_UP",
            "SUBSCRIBE",
            "REGISTER",
            "REQUEST_DEMO",
            "JOIN",
            "ATTEND",
          ])
          .optional()
          .describe("Call to action button label"),
        intendedStatus: z
          .enum(["ACTIVE", "DRAFT"])
          .optional()
          .describe("Initial status. Default: DRAFT"),
        name: z
          .string()
          .optional()
          .describe("Name for the creative (internal reference)"),
        leadgenFormId: z
          .string()
          .optional()
          .describe("Lead gen form ID for LEAD_GENERATION campaigns"),
        leadgenCallToActionLabel: z
          .enum([
            "APPLY",
            "DOWNLOAD",
            "VIEW_QUOTE",
            "LEARN_MORE",
            "SIGN_UP",
            "SUBSCRIBE",
            "REGISTER",
            "REQUEST_DEMO",
            "JOIN",
            "ATTEND",
          ])
          .optional()
          .describe("Call to action label for lead gen form button"),
      },
      async (input) => {
        try {
          const data: Parameters<
            typeof client.createInlineCreative
          >[1] = {
            campaign: input.campaignId,
            intendedStatus: input.intendedStatus || "DRAFT",
            organizationId: input.organizationId,
            commentary: input.commentary,
          };

          if (input.mediaId) data.mediaId = input.mediaId;
          if (input.mediaTitle)
            data.mediaTitle = input.mediaTitle;
          if (input.landingPageUrl)
            data.landingPageUrl = input.landingPageUrl;
          if (input.callToActionLabel)
            data.callToActionLabel = input.callToActionLabel;
          if (input.name) data.name = input.name;
          if (input.leadgenFormId) {
            data.leadgenCallToAction = {
              destination: input.leadgenFormId.startsWith("urn:")
                ? input.leadgenFormId
                : `urn:li:adForm:${input.leadgenFormId}`,
              label:
                input.leadgenCallToActionLabel || "LEARN_MORE",
            };
          }

          const result = await client.createInlineCreative(
            input.accountId,
            data
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    creativeId: result.id,
                    campaignId: input.campaignId,
                    intendedStatus:
                      input.intendedStatus || "DRAFT",
                    message: `Inline ad created successfully under campaign ${input.campaignId}`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }
}

// ==================== Helper ====================

function getDefaultStartDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().split("T")[0];
}

// ==================== Worker Entry ====================

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response(
        JSON.stringify({
          name: "LinkedIn Ads Agency MCP Server",
          version: "1.0.0",
          description:
            "MCP server for managing LinkedIn Ads across multiple client accounts",
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!env.MCP_AUTH_TOKEN) {
      return new Response("Server misconfigured", { status: 500 });
    }

    const match = url.pathname.match(/^\/(mcp|sse)\/([^/]+)(\/.*)?$/);
    if (match) {
      const [, transport, providedToken, rest = ""] = match;
      if (!timingSafeEqual(providedToken, env.MCP_AUTH_TOKEN)) {
        return new Response("Not Found", { status: 404 });
      }
      const rewrittenUrl = new URL(url);
      rewrittenUrl.pathname = `/${transport}${rest}`;
      const rewritten = new Request(rewrittenUrl.toString(), request);

      if (transport === "mcp") {
        return LinkedInAdsMCP.serve("/mcp").fetch(rewritten, env, ctx);
      }
      return LinkedInAdsMCP.serveSSE("/sse").fetch(rewritten, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },
};
