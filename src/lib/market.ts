import path from "path";
import { readJson, writeJson } from "./jsonFile";

// Market studies: dated snapshots of public indicators (search interest,
// official statistics, market size) per country and skill. Each collection
// run is stored as a new study so the evolution stays visible; nothing is
// computed here, the page derives scores from the raw figures.

export type Indicator = { value: number; year: string };

export type MarketStudy = {
  id: string;
  title: string;
  collectedAt: string;
  countries: string[];
  skills: string[];
  // Profile families (display order) -> skills.
  families?: Record<string, string[]>;
  // Google Trends index (0-100) per skill, then per country: compares
  // countries for one skill.
  trends: Record<string, Record<string, number>>;
  // Interest relative to the anchor skill measured in the same request:
  // compares skills within one country.
  anchor?: string;
  vsAnchor?: Record<string, Record<string, number>>;
  topics?: Record<string, string>;
  eurostat?: {
    ict_share?: Record<string, Indicator>;
    hard_to_fill?: Record<string, Indicator>;
  };
  // WooCommerce stores per country.
  stores?: Record<string, number | null>;
  // Supply: developers per country and per language (GitHub Innovation
  // Graph), each skill being measured through the language that signals it.
  supply?: {
    period: string;
    developers: Record<string, number>;
    languages: Record<string, Record<string, number>>;
    skillLanguages: Record<string, string[]>;
    ictThousands?: Record<string, Indicator>;
  };
  // Working conditions: on site / hybrid / remote, full-time / part-time /
  // work-study, on the employers' side (job ads) and the providers' side.
  work?: WorkStudy;
  sources: { id: string; label: string; url: string }[];
  notes?: string;
};

export type Trend = { date: string; value: number; yearAgo: number | null };

export type DevProfile = {
  n: number;
  // % of answers: full remote, hybrid leaning flexible, hybrid leaning on site, on site.
  remote: { remote: number | null; hybridFlex: number | null; hybridOnsite: number | null; onsite: number | null };
  // % of respondents.
  status: { employed: number | null; freelance: number | null; student: number | null; workStudy: number | null; partTime: number | null };
};

export type DevCounts = {
  n: number;
  remoteN: number;
  remote: Partial<Record<keyof DevProfile["remote"], number>>;
  status: Partial<Record<keyof DevProfile["status"], number>>;
};

export type WorkStudy = {
  // Indeed: % of job ads offering remote or hybrid work, and % of job
  // seekers' searches targeting it.
  postings?: Record<string, { all: Trend; software?: Trend | null; it?: Trend | null; searches?: Trend | null }>;
  // Eurostat: % working from home usually / sometimes / never.
  wfh?: Record<"employees" | "selfEmployed", Record<string, { usually?: number; sometimes?: number; never?: number; year: string }>>;
  partTime?: Record<string, Indicator>;
  partTimeProfessionals?: Record<string, Indicator>;
  trainingContracts?: Record<string, Indicator>;
  developers?: {
    byCountry: Record<string, DevProfile>;
    bySkill: Record<string, DevProfile & { measuredBy: string }>;
    // Country -> skill -> raw counts, summed by the page for any filter.
    counts?: Record<string, Record<string, DevCounts>>;
    scope: string;
  };
  sources: { id: string; label: string; url: string }[];
};

export type MarketStudyInput = Omit<MarketStudy, "id" | "title"> & { id?: string; title?: string };

const FILE = path.join(process.cwd(), "data", "market-studies.json");

export async function listStudies(): Promise<MarketStudy[]> {
  const studies = await readJson<MarketStudy[]>(FILE, []);
  return studies.sort((a, b) => b.collectedAt.localeCompare(a.collectedAt) || b.id.localeCompare(a.id));
}

function isStudy(v: unknown): v is MarketStudyInput {
  const s = v as MarketStudyInput;
  return (
    !!s &&
    typeof s.collectedAt === "string" &&
    Array.isArray(s.countries) &&
    Array.isArray(s.skills) &&
    !!s.trends &&
    typeof s.trends === "object" &&
    Array.isArray(s.sources)
  );
}

// Adds a study, or replaces the one with the same id (re-running a collection
// the same day overwrites it instead of piling up duplicates).
export async function saveStudy(input: unknown): Promise<MarketStudy | null> {
  if (!isStudy(input)) return null;
  const study: MarketStudy = {
    ...input,
    id: (input.id ?? input.collectedAt).slice(0, 40),
    title: (input.title ?? `Étude du ${input.collectedAt}`).slice(0, 120),
  };
  const studies = await readJson<MarketStudy[]>(FILE, []);
  const next = [...studies.filter((s) => s.id !== study.id), study];
  await writeJson(FILE, next);
  return study;
}
