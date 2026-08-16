import { createCompanyWebSource } from "./company-web.js";
import { createJobsSource } from "./jobs.js";
import { createLeadershipSource } from "./leadership.js";
import { createNewsSource } from "./news.js";
import { createSecSource } from "./sec.js";
import type { CollectorContext, ResearchSource, SourceFactory } from "./types.js";

/**
 * The collector registry. Adding a source is one import and one line here —
 * see CONTRIBUTING notes in the README. Order is display order in the CLI.
 */
export const SOURCE_FACTORIES: SourceFactory[] = [
  createCompanyWebSource,
  createNewsSource,
  createJobsSource,
  createSecSource,
  createLeadershipSource,
];

export function createSources(ctx: CollectorContext): ResearchSource[] {
  return SOURCE_FACTORIES.map((factory) => factory(ctx));
}

export { CollectorSkip } from "./types.js";
export type { CollectorContext, ResearchSource, SourceFactory } from "./types.js";
