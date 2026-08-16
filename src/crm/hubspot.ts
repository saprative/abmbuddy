import { Client } from "@hubspot/api-client";
import type { Config } from "../config/index.js";
import { normalizeDomain, type Company } from "../models/company.js";
import type { AccountResearch } from "../models/research.js";
import { log } from "../util/logger.js";
import { getAccessToken, readTokens } from "./hubspot-auth.js";
import { CrmAuthError, type CRMProvider, type ListCompaniesOptions } from "./provider.js";
import { PROPERTIES, PROPERTY_GROUP, buildProperties } from "./summary.js";

/** The CRM fields ABMBuddy reads. Everything else stays HubSpot's business. */
const READ_PROPERTIES = [
  "name",
  "domain",
  "website",
  "description",
  "industry",
  "country",
  "city",
  "numberofemployees",
  "annualrevenue",
  "linkedin_company_page",
];

const PAGE_SIZE = 100;

export class HubSpotProvider implements CRMProvider {
  readonly name = "hubspot";
  readonly label = "HubSpot";

  private client: Client | undefined;
  private propertiesEnsured = false;

  constructor(private readonly config: Config) {}

  async connect(): Promise<void> {
    const token = await getAccessToken(this.config);
    this.client = new Client({ accessToken: token, numberOfApiCallRetries: 3 });
  }

  async describe(): Promise<string> {
    const tokens = await readTokens();
    if (!tokens) return "not connected";
    const mode = tokens.mode === "oauth" ? "OAuth" : "service key / token";
    const portal = this.config.crm.portalId ? ` · portal ${this.config.crm.portalId}` : "";
    return `${mode}${portal}`;
  }

  async getCompanies(options: ListCompaniesOptions = {}): Promise<Company[]> {
    const client = await this.api();
    const companies: Company[] = [];
    let after: string | undefined;

    while (true) {
      if (options.signal?.aborted) break;
      const page = options.query
        ? await client.crm.companies.searchApi.doSearch({
            query: options.query,
            limit: PAGE_SIZE,
            properties: READ_PROPERTIES,
            ...(after ? { after } : {}),
          })
        : await client.crm.companies.basicApi.getPage(PAGE_SIZE, after, READ_PROPERTIES);

      for (const result of page.results ?? []) {
        const company = toCompany(result.id, result.properties as Record<string, string | null>);
        if (company) companies.push(company);
      }
      options.onPage?.(companies.length);

      after = page.paging?.next?.after;
      if (!after) break;
      if (options.limit && companies.length >= options.limit) break;
    }

    log.debug("hubspot", `loaded ${companies.length} companies`);
    return options.limit ? companies.slice(0, options.limit) : companies;
  }

  async updateCompany(companyId: string, result: AccountResearch): Promise<void> {
    const client = await this.api();
    await this.ensureProperties();
    const properties = buildProperties(result);
    log.debug("hubspot", `updating company ${companyId}`, Object.keys(properties));
    await client.crm.companies.basicApi.update(companyId, { properties });
  }

  /**
   * Creates the ABMBuddy property group and any missing properties. Runs once
   * per process and is safe to call against a portal that already has them.
   */
  async ensureProperties(): Promise<void> {
    if (this.propertiesEnsured) return;
    const client = await this.api();

    try {
      const groups = await client.crm.properties.groupsApi.getAll("companies");
      if (!groups.results?.some((group) => group.name === PROPERTY_GROUP.name)) {
        await client.crm.properties.groupsApi.create("companies", {
          name: PROPERTY_GROUP.name,
          label: PROPERTY_GROUP.label,
          displayOrder: -1,
        });
        log.debug("hubspot", "created property group");
      }
    } catch (error) {
      throw wrapError(error, "Could not read or create the ABMBuddy property group");
    }

    const existing = new Set<string>();
    try {
      const all = await client.crm.properties.coreApi.getAll("companies");
      for (const property of all.results ?? []) existing.add(property.name);
    } catch (error) {
      throw wrapError(error, "Could not list company properties");
    }

    for (const definition of PROPERTIES) {
      if (existing.has(definition.name)) continue;
      try {
        await client.crm.properties.coreApi.create("companies", {
          name: definition.name,
          label: definition.label,
          type: definition.type,
          fieldType: definition.fieldType,
          groupName: PROPERTY_GROUP.name,
          description: definition.description,
          formField: false,
          hasUniqueValue: false,
          hidden: false,
        } as Parameters<typeof client.crm.properties.coreApi.create>[1]);
        log.debug("hubspot", `created property ${definition.name}`);
      } catch (error) {
        // A concurrent run may have created it a moment ago; only a real
        // failure (permissions, quota) should stop the write-back.
        if (!isConflict(error)) throw wrapError(error, `Could not create property ${definition.name}`);
      }
    }

    this.propertiesEnsured = true;
  }

  /** Re-reads the token each time so a long run survives token expiry. */
  private async api(): Promise<Client> {
    const token = await getAccessToken(this.config);
    if (!this.client) {
      this.client = new Client({ accessToken: token, numberOfApiCallRetries: 3 });
    } else {
      this.client.setAccessToken(token);
    }
    return this.client;
  }
}

export function createHubSpotProvider(config: Config): HubSpotProvider {
  return new HubSpotProvider(config);
}

function toCompany(id: string, properties: Record<string, string | null> | undefined): Company | undefined {
  const name = properties?.name?.trim();
  const domain = normalizeDomain(properties?.domain ?? properties?.website ?? undefined);
  if (!name && !domain) return undefined;
  return {
    id,
    name: name || (domain as string),
    ...(domain ? { domain } : {}),
    ...(properties?.website ? { website: properties.website } : {}),
    ...(properties?.description ? { description: properties.description } : {}),
    ...(properties?.industry ? { industry: properties.industry } : {}),
    ...(properties?.country ? { country: properties.country } : {}),
    ...(properties?.city ? { city: properties.city } : {}),
    ...(numeric(properties?.numberofemployees) !== undefined
      ? { employeeCount: numeric(properties?.numberofemployees) }
      : {}),
    ...(numeric(properties?.annualrevenue) !== undefined
      ? { annualRevenue: numeric(properties?.annualrevenue) }
      : {}),
    ...(properties?.linkedin_company_page ? { linkedinUrl: properties.linkedin_company_page } : {}),
    source: "hubspot",
  };
}

function numeric(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isConflict(error: unknown): boolean {
  const code = (error as { code?: number })?.code;
  return code === 409;
}

function wrapError(error: unknown, context: string): Error {
  const code = (error as { code?: number })?.code;
  const message = (error as { body?: { message?: string } })?.body?.message ?? String(error);
  if (code === 401 || code === 403) {
    return new CrmAuthError(
      `${context}: HubSpot denied the request (${message}). Check the connected app has the companies read/write and schema scopes.`,
    );
  }
  return new Error(`${context}: ${message}`);
}
