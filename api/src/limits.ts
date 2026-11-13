export const LIMITS = {
  maxUploadBytes: 5 * 1024 * 1024,
  maxWebsitePages: 5,
  maxWebsiteSeconds: 60,
  maxHtmlBytes: 512 * 1024,
  maxTextExtractChars: 60_000,
  maxAnalysisChars: 18_000,
  maxBrandDnaChars: 24_000,
  maxAnalysisImageInputs: 8,
  maxImagesPerGeneration: 1,
  globalWeeklyHardLimit: 120,
  /** Weekly OpenAI spend cap for the whole demo (override with OPENAI_WEEKLY_BUDGET_USD). */
  weeklyAiBudgetUsd: 3,
  /** Sources extracted/analysed per /api/pipeline/run call; the page loops until done. */
  pipelineSourcesPerRequest: 2,
  socialPostCount: 5
} as const;

export const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".html", ".htm", ".log"]);
export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"]);
export const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".xls", ".pptx"]);
export const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS]);

export const SOCIAL_SOURCE_TYPES = new Set(["instagram", "facebook"]);
export const GLOBAL_SCAN_SOURCE_TYPES = ["instagram", "facebook", "website", "google_maps", "recruitment"] as const;

export const URL_SOURCE_CONFIG: Record<string, { label: string; crawlLimit: number; maxDepth?: number }> = {
  instagram: { label: "Instagram", crawlLimit: 5 },
  facebook: { label: "Facebook", crawlLimit: 5 },
  website: { label: "官網", crawlLimit: LIMITS.maxWebsitePages, maxDepth: 2 },
  google_maps: { label: "Google 商家/地圖", crawlLimit: 1 },
  google_reviews: { label: "Google 評論", crawlLimit: 1 },
  recruitment: { label: "招募人才網站", crawlLimit: 3 },
  compliance_rule: { label: "品牌規範", crawlLimit: 1 },
  internal_rule: { label: "內部規範", crawlLimit: 1 },
  custom: { label: "自訂資料", crawlLimit: 1 }
};
