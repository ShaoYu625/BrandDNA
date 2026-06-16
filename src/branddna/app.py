"""BrandDNA Analytics Platform.

Local demo implementation for the zao_shih breakfast shop case.
The app keeps the original single-process Flask shape, but stores real raw data,
job state, Brand DNA snapshots, and generated artifacts in SQLite.
"""

from __future__ import annotations

import base64
from io import BytesIO
import json
import mimetypes
import os
import re
import sqlite3
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse
from xml.etree import ElementTree as ET

from dotenv import dotenv_values, load_dotenv
from flask import Flask, g, has_request_context, jsonify, render_template, request, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

try:
    from openai import OpenAI
except ImportError:  # Keep local non-LLM flows testable before dependencies are installed.
    OpenAI = None


PACKAGE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PACKAGE_DIR.parents[1]

ENV_PATH = PROJECT_ROOT / ".env"
load_dotenv(ENV_PATH, override=False)
for env_key, env_value in dotenv_values(ENV_PATH).items():
    if env_value is not None and env_key.startswith("OPENAI_"):
        os.environ[env_key] = env_value

BASE_DIR = PROJECT_ROOT
RUNTIME_FOLDER = Path(os.getenv("RUNTIME_FOLDER", BASE_DIR / "runtime"))
DATA_FOLDER = Path(os.getenv("DATA_FOLDER", RUNTIME_FOLDER / "data"))
DEMO_DATA_FOLDER = Path(os.getenv("DEMO_DATA_FOLDER", BASE_DIR / "examples" / "demo_sources"))
RAWDATA_FOLDER = Path(os.getenv("RAWDATA_FOLDER", RUNTIME_FOLDER / "rawdata"))
ARTIFACT_FOLDER = Path(os.getenv("ARTIFACT_FOLDER", RUNTIME_FOLDER / "artifacts"))
UPLOAD_FOLDER = Path(os.getenv("UPLOAD_FOLDER", RUNTIME_FOLDER / "uploads"))
LOG_FOLDER = Path(os.getenv("LOG_FOLDER", RUNTIME_FOLDER / "logs"))
SYSTEM_LOG_PATH = LOG_FOLDER / "system.log.jsonl"
DB_PATH = Path(os.getenv("APP_DB_PATH", DATA_FOLDER / "app.sqlite3"))

for folder in (DATA_FOLDER, RAWDATA_FOLDER, ARTIFACT_FOLDER, UPLOAD_FOLDER, LOG_FOLDER):
    folder.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", os.urandom(24))
CORS(app)


@app.before_request
def attach_request_id() -> None:
    g.request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    g.request_started_at = time.perf_counter()


@app.after_request
def log_http_request(response):
    if request.path.startswith("/api/"):
        started_at = getattr(g, "request_started_at", None)
        duration_ms = int((time.perf_counter() - started_at) * 1000) if started_at else None
        level = "error" if response.status_code >= 500 else "warning" if response.status_code >= 400 else "info"
        log_event(
            level,
            "http.request",
            f"{request.method} {request.path} -> {response.status_code}",
            stage=request.endpoint,
            details={"method": request.method, "path": request.path, "status_code": response.status_code},
            duration_ms=duration_ms,
        )
    return response

OPENAI_API_KEY_PLACEHOLDERS = {
    "your_openai_api_key",
    "your-api-key",
    "your_api_key",
    "openai_api_key",
    "sk-your-key",
}


def normalize_openai_api_key(value: str | None) -> str | None:
    key = str(value or "").strip().strip('"').strip("'")
    if not key:
        return None
    lowered = key.lower()
    if lowered in OPENAI_API_KEY_PLACEHOLDERS or lowered.startswith("your_") or lowered.startswith("your-"):
        return None
    return key


raw_openai_api_key = os.getenv("OPENAI_API_KEY")
openai_api_key = normalize_openai_api_key(raw_openai_api_key)
openai_client = OpenAI(api_key=openai_api_key) if OpenAI and openai_api_key else None
OPENAI_REASONING_MODEL = os.getenv("OPENAI_REASONING_MODEL", "gpt-5.4")
OPENAI_BALANCED_MODEL = os.getenv("OPENAI_BALANCED_MODEL", "gpt-5.4-mini")
OPENAI_FAST_MODEL = os.getenv("OPENAI_FAST_MODEL", "gpt-5.4-nano")
OPENAI_MODELS = {
    "source_analysis": os.getenv("OPENAI_MODEL_SOURCE_ANALYSIS", OPENAI_BALANCED_MODEL),
    "brand_dna": os.getenv("OPENAI_MODEL_BRAND_DNA", OPENAI_REASONING_MODEL),
    "diagnosis": os.getenv("OPENAI_MODEL_DIAGNOSIS", OPENAI_REASONING_MODEL),
    "image_prompt": os.getenv("OPENAI_MODEL_IMAGE_PROMPT", OPENAI_BALANCED_MODEL),
    "brand_image": os.getenv("OPENAI_MODEL_BRAND_IMAGE", OPENAI_BALANCED_MODEL),
    "character_image": os.getenv("OPENAI_MODEL_CHARACTER_IMAGE", "gpt-image-2"),
    "content_generation": os.getenv("OPENAI_MODEL_CONTENT_GENERATION", OPENAI_BALANCED_MODEL),
    "marketing_suggestions": os.getenv("OPENAI_MODEL_MARKETING_SUGGESTIONS", OPENAI_FAST_MODEL),
    "risk_check": os.getenv("OPENAI_MODEL_RISK_CHECK", OPENAI_REASONING_MODEL),
    "simulation": os.getenv("OPENAI_MODEL_SIMULATION", OPENAI_BALANCED_MODEL),
    "ocr": os.getenv("OPENAI_MODEL_OCR", OPENAI_BALANCED_MODEL),
    "default": os.getenv("OPENAI_MODEL_DEFAULT", OPENAI_BALANCED_MODEL),
}
OPENAI_REASONING_EFFORT = {
    "source_analysis": os.getenv("OPENAI_REASONING_SOURCE_ANALYSIS", "none"),
    "brand_dna": os.getenv("OPENAI_REASONING_BRAND_DNA", "low"),
    "diagnosis": os.getenv("OPENAI_REASONING_DIAGNOSIS", "none"),
    "image_prompt": os.getenv("OPENAI_REASONING_IMAGE_PROMPT", "none"),
    "brand_image": os.getenv("OPENAI_REASONING_BRAND_IMAGE", "none"),
    "content_generation": os.getenv("OPENAI_REASONING_CONTENT_GENERATION", "none"),
    "marketing_suggestions": os.getenv("OPENAI_REASONING_MARKETING_SUGGESTIONS", "none"),
    "risk_check": os.getenv("OPENAI_REASONING_RISK_CHECK", "low"),
    "simulation": os.getenv("OPENAI_REASONING_SIMULATION", "none"),
    "ocr": os.getenv("OPENAI_REASONING_OCR", "none"),
    "default": os.getenv("OPENAI_REASONING_DEFAULT", "none"),
}
OPENAI_REASONING_DISABLED_VALUES = {"", "none", "off", "false", "0", "disabled", "no"}
OPENAI_VERBOSITY = {
    "source_analysis": os.getenv("OPENAI_VERBOSITY_SOURCE_ANALYSIS", "low"),
    "brand_dna": os.getenv("OPENAI_VERBOSITY_BRAND_DNA", "medium"),
    "diagnosis": os.getenv("OPENAI_VERBOSITY_DIAGNOSIS", "medium"),
    "image_prompt": os.getenv("OPENAI_VERBOSITY_IMAGE_PROMPT", "low"),
    "brand_image": os.getenv("OPENAI_VERBOSITY_BRAND_IMAGE", "low"),
    "content_generation": os.getenv("OPENAI_VERBOSITY_CONTENT_GENERATION", "medium"),
    "marketing_suggestions": os.getenv("OPENAI_VERBOSITY_MARKETING_SUGGESTIONS", "low"),
    "risk_check": os.getenv("OPENAI_VERBOSITY_RISK_CHECK", "medium"),
    "simulation": os.getenv("OPENAI_VERBOSITY_SIMULATION", "medium"),
    "ocr": os.getenv("OPENAI_VERBOSITY_OCR", "low"),
    "default": os.getenv("OPENAI_VERBOSITY_DEFAULT", "low"),
}
OPENAI_IMAGE_DETAIL = {
    "ocr": os.getenv("OPENAI_IMAGE_DETAIL_OCR", "high"),
    "default": os.getenv("OPENAI_IMAGE_DETAIL_DEFAULT", "high"),
}
OPENAI_TOKEN_PRICING_PER_1M_USD = {
    "standard": {
        "gpt-5.5": (5.0, 0.5, 30.0),
        "gpt-5.5-pro": (30.0, None, 180.0),
        "gpt-5.4": (2.5, 0.25, 15.0),
        "gpt-5.4-mini": (0.75, 0.075, 4.5),
        "gpt-5.4-nano": (0.2, 0.02, 1.25),
        "gpt-5.4-pro": (30.0, None, 180.0),
        "gpt-5.2": (1.75, 0.175, 14.0),
        "gpt-5.2-pro": (21.0, None, 168.0),
        "gpt-5.1": (1.25, 0.125, 10.0),
        "gpt-5": (1.25, 0.125, 10.0),
        "gpt-5-mini": (0.25, 0.025, 2.0),
        "gpt-5-nano": (0.05, 0.005, 0.4),
        "gpt-5-pro": (15.0, None, 120.0),
        "gpt-4.1": (2.0, 0.5, 8.0),
        "gpt-4.1-mini": (0.4, 0.1, 1.6),
        "gpt-4.1-nano": (0.1, 0.025, 0.4),
        "gpt-4o": (2.5, 1.25, 10.0),
        "gpt-4o-2024-05-13": (5.0, None, 15.0),
        "gpt-4o-mini": (0.15, 0.075, 0.6),
        "o1": (15.0, 7.5, 60.0),
        "o1-pro": (150.0, None, 600.0),
        "o3-pro": (20.0, None, 80.0),
        "o3": (2.0, 0.5, 8.0),
        "o4-mini": (1.1, 0.275, 4.4),
        "o3-mini": (1.1, 0.55, 4.4),
        "o1-mini": (1.1, 0.55, 4.4),
        "gpt-4-turbo-2024-04-09": (10.0, None, 30.0),
        "gpt-4-0125-preview": (10.0, None, 30.0),
        "gpt-4-1106-preview": (10.0, None, 30.0),
        "gpt-4-1106-vision-preview": (10.0, None, 30.0),
        "gpt-4-0613": (30.0, None, 60.0),
        "gpt-4-0314": (30.0, None, 60.0),
        "gpt-4-32k": (60.0, None, 120.0),
        "gpt-3.5-turbo": (0.5, None, 1.5),
        "gpt-3.5-turbo-0125": (0.5, None, 1.5),
        "gpt-3.5-turbo-1106": (1.0, None, 2.0),
        "gpt-3.5-turbo-0613": (1.5, None, 2.0),
        "gpt-3.5-0301": (1.5, None, 2.0),
        "gpt-3.5-turbo-instruct": (1.5, None, 2.0),
        "gpt-3.5-turbo-16k-0613": (3.0, None, 4.0),
        "davinci-002": (2.0, None, 2.0),
        "babbage-002": (0.4, None, 0.4),
    },
    "flex": {
        "gpt-5.5": (2.5, 0.25, 15.0),
        "gpt-5.5-pro": (15.0, None, 90.0),
        "gpt-5.4": (1.25, 0.13, 7.5),
        "gpt-5.4-mini": (0.375, 0.0375, 2.25),
        "gpt-5.4-nano": (0.1, 0.01, 0.625),
        "gpt-5.4-pro": (15.0, None, 90.0),
        "gpt-5.2": (0.875, 0.0875, 7.0),
        "gpt-5.1": (0.625, 0.0625, 5.0),
        "gpt-5": (0.625, 0.0625, 5.0),
        "gpt-5-mini": (0.125, 0.0125, 1.0),
        "gpt-5-nano": (0.025, 0.0025, 0.2),
        "o3": (1.0, 0.25, 4.0),
        "o4-mini": (0.55, 0.138, 2.2),
    },
    "priority": {
        "gpt-5.5": (12.5, 1.25, 75.0),
        "gpt-5.4": (5.0, 0.5, 30.0),
        "gpt-5.4-mini": (1.5, 0.15, 9.0),
        "gpt-5.2": (3.5, 0.35, 28.0),
        "gpt-5.1": (2.5, 0.25, 20.0),
        "gpt-5": (2.5, 0.25, 20.0),
        "gpt-5-mini": (0.45, 0.045, 3.6),
        "gpt-4.1": (3.5, 0.875, 14.0),
        "gpt-4.1-mini": (0.7, 0.175, 2.8),
        "gpt-4.1-nano": (0.2, 0.05, 0.8),
        "gpt-4o": (4.25, 2.125, 17.0),
        "gpt-4o-2024-05-13": (8.75, None, 26.25),
        "gpt-4o-mini": (0.25, 0.125, 1.0),
        "o3": (3.5, 0.875, 14.0),
        "o4-mini": (2.0, 0.5, 8.0),
    },
}
OPENAI_SERVICE_TIER_PRICING_ALIASES = {
    "auto": "standard",
    "default": "standard",
    "standard": "standard",
    "flex": "flex",
    "priority": "priority",
}
OPENAI_MODEL_VARIANT_SUFFIXES = {"mini", "nano", "pro", "turbo", "preview", "instruct", "32k"}

OPENAI_BASE_PROMPT_CONTRACT = """
<instruction_priority>
- Follow the task-specific instructions and output schema exactly.
- Safety, privacy, and factual accuracy take priority over style.
- If context is insufficient for a required claim, return the safest supported answer and mark the missing context inside the requested output field.
</instruction_priority>

<grounding_rules>
- Base conclusions only on the supplied prompt context, extracted source text, Brand DNA data, or explicit user inputs.
- Do not invent URLs, citations, customer quotes, legal requirements, metrics, menu items, or source facts.
- If a statement is an inference, phrase it as an inference rather than a fact.
</grounding_rules>

<verification_loop>
- Before finalizing, check that every requested field is present.
- Check that scores are within the requested range and that arrays contain concise, useful items.
- Remove unsupported claims and duplicate items.
</verification_loop>
""".strip()

OPENAI_JSON_PROMPT_CONTRACT = """
<structured_output_contract>
- Output only valid JSON. Do not include Markdown fences, prose, comments, or trailing text.
- Use the exact keys requested by the prompt. Preserve the requested value types.
- Validate that braces, brackets, and strings are balanced before finalizing.
- If the input is insufficient, still return valid JSON with conservative scores, empty arrays, or short missing-context notes in relevant fields.
</structured_output_contract>

<verbosity_controls>
- Keep JSON values concise and information-dense.
- Prefer concrete observations over generic brand language.
- Avoid repeating the prompt.
</verbosity_controls>
""".strip()

OPENAI_TEXT_PROMPT_CONTRACT = """
<output_contract>
- Return only the requested text format.
- Keep the answer concise and directly usable by downstream BrandDNA analysis.
- Do not add extra sections unless requested.
</output_contract>
""".strip()

OPENAI_TASK_PROMPT_CONTRACTS = {
    "source_analysis": """
<task_contract>
- Identify evidence-backed brand archetype signals from one source.
- Use the 12 Brand Archetypes as the primary personality language.
- If scores are requested, use 0-100 integer scores for archetype fit.
- Mention risks only when grounded in the source text or clearly marked as an evidence gap.
- Keep each reasoning field to one concise sentence.
</task_contract>
""".strip(),
    "brand_dna": """
<task_contract>
- Synthesize across analyzed sources rather than summarizing them one by one.
- Resolve conflicting signals by weighting repeated, recent, and direct customer/business evidence more heavily.
- Produce a practical brand data foundation usable for diagnosis, brand role creation, compliant copywriting, and market prediction.
- Include a complete brand character based on the 12 Brand Archetypes.
- Treat the task as incomplete until every requested Brand DNA field is filled.
</task_contract>
""".strip(),
    "diagnosis": """
<task_contract>
- Produce brand-role diagnosis grounded in the current brand data and source summary.
- Focus on data readiness, 12 Brand Archetype fit, positioning, traits, voice, visual personality, and target audience.
- Do not include market trends, benchmark analysis, competitor gaps, or improvement recommendations.
</task_contract>
""".strip(),
    "image_prompt": """
<task_contract>
- Write image prompts that are visually specific, brand-consistent, and safe for marketing use.
- Avoid unsupported brand claims, logos, or real-person likeness unless provided by the user.
- The English prompt should be production-ready for image generation.
</task_contract>
""".strip(),
    "content_generation": """
<task_contract>
- Generate final customer-facing Traditional Chinese IG or FB social content only.
- Use the brand character and its target audience as the primary audience source.
- Apply compliance rules before producing the final version; do not present a separate post-generation review flow.
- Avoid medical, legal, exaggerated, or unverifiable claims and avoid forbidden words.
- Do not ask follow-up questions; proceed using the provided context.
</task_contract>
""".strip(),
    "marketing_suggestions": """
<task_contract>
- Generate exactly three concise Traditional Chinese marketing request suggestions for dashboard quick buttons.
- Each suggestion must fit the supplied store category, brand character, target audience, likely products, and practical restaurant marketing moments.
- Do not generate final post copy, hashtags, risk analysis, or generic strategy advice.
</task_contract>
""".strip(),
    "risk_check": """
<task_contract>
- Review marketing compliance and brand-rule fit conservatively.
- Tie each violation to the exact phrase or missing evidence when possible.
- Always provide a safe_content rewrite when the input is risky or unclear.
- Do not invent laws; use provided rules, brand data, and general restaurant marketing caution.
</task_contract>
""".strip(),
    "simulation": """
<task_contract>
- Produce positive market prediction summaries as directional estimates, not factual survey results.
- Do not write persona dialogue, interviews, negative reactions, concerns, risks, or improvement suggestions.
- Keep the output to positive attraction reasons, likely acceptance, and the top two target audiences.
</task_contract>
""".strip(),
    "ocr": """
<task_contract>
- Extract readable text and important visual context from the image.
- Preserve visible names, prices, dates, menu items, UI labels, and promotion details when legible.
- If text is unclear, mark it as unclear instead of guessing.
</task_contract>
""".strip(),
}

DEFAULT_BRAND = {
    "handle": "zao_shih",
    "name": "沒事早事坐",
    "category": "台式早午餐",
    "location": "台北市",
    "description": "以在地早餐、親切服務與社群互動為核心的 BrandDNA demo 品牌。",
}

DEFAULT_BRAND.update(
    {
        "name": "沒事早事坐",
        "category": "台式早午餐",
        "location": "台北市",
        "description": "示範用餐飲品牌，用於 BrandDNA 分析、內容生成與風險檢查流程。",
    }
)

BRAND_ARCHETYPES = {
    "innocent": {"name_zh": "天真者", "name_en": "The Innocent", "role_name": "天真者型品牌", "description": "單純、安心、樂觀，讓顧客感到放心。"},
    "explorer": {"name_zh": "探險家", "name_en": "The Explorer", "role_name": "探險家型品牌", "description": "自由、探索、嘗鮮，鼓勵顧客發現新體驗。"},
    "sage": {"name_zh": "智者", "name_en": "The Sage", "role_name": "智者型品牌", "description": "專業、知識、可信，協助顧客做出明智選擇。"},
    "hero": {"name_zh": "英雄", "name_en": "The Hero", "role_name": "英雄型品牌", "description": "自信、突破、行動，鼓舞顧客達成目標。"},
    "outlaw": {"name_zh": "叛逆者", "name_en": "The Outlaw", "role_name": "叛逆者型品牌", "description": "顛覆、鮮明、反常規，吸引喜歡差異感的顧客。"},
    "magician": {"name_zh": "魔法師", "name_en": "The Magician", "role_name": "魔法師型品牌", "description": "轉化、驚喜、想像，創造令人期待的體驗。"},
    "everyman": {"name_zh": "凡人", "name_en": "The Everyman", "role_name": "凡人型品牌", "description": "親近、日常、歸屬，像熟悉的朋友一樣陪伴顧客。"},
    "lover": {"name_zh": "愛人", "name_en": "The Lover", "role_name": "愛人型品牌", "description": "感性、美感、關係，強調愉悅與被珍惜的感受。"},
    "jester": {"name_zh": "小丑", "name_en": "The Jester", "role_name": "小丑型品牌", "description": "幽默、玩心、輕鬆，讓互動充滿趣味。"},
    "caregiver": {"name_zh": "照顧者", "name_en": "The Caregiver", "role_name": "照顧者型品牌", "description": "照顧、溫暖、支持，重視安心與貼心服務。"},
    "creator": {"name_zh": "創造者", "name_en": "The Creator", "role_name": "創造者型品牌", "description": "創意、設計、表達，重視原創與風格辨識。"},
    "ruler": {"name_zh": "統治者", "name_en": "The Ruler", "role_name": "統治者型品牌", "description": "秩序、品質、領導，傳達穩定、精緻與掌控感。"},
}

# Kept for legacy snapshots and tests. New UI/prompt logic uses BRAND_ARCHETYPES.
PERSONALITY_DIMENSIONS = {
    "sincerity": {"name": "真誠", "description": "親切、可信、重視顧客感受"},
    "activity": {"name": "活力", "description": "節奏明快、有生活感、具社群互動性"},
    "competence": {"name": "專業", "description": "品質穩定、資訊清楚、執行可靠"},
    "authenticity": {"name": "真實", "description": "保有在地特色與自然語氣"},
    "competitiveness": {"name": "競爭力", "description": "差異化明確、能吸引目標客群"},
}

TEXT_EXTENSIONS = {".txt", ".md", ".markdown", ".csv", ".json", ".html", ".htm", ".log"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
DOCUMENT_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".xls", ".pptx"}
SUPPORTED_EXTENSIONS = TEXT_EXTENSIONS | IMAGE_EXTENSIONS | DOCUMENT_EXTENSIONS

SOCIAL_POST_SOURCE_TYPES = {"instagram", "facebook"}
SOCIAL_POST_COUNT = 5
MAX_SOCIAL_IMAGES_PER_POST = 3
WEBSITE_CRAWL_LIMIT = 20
WEBSITE_MAX_DEPTH = 3
WEBSITE_MAX_SECONDS = 90
WEBSITE_MAX_IMAGES_PER_PAGE = 2
MAX_ANALYSIS_IMAGE_INPUTS = int(os.getenv("MAX_ANALYSIS_IMAGE_INPUTS", "8"))

GLOBAL_SCAN_URL_SOURCE_TYPES = ["instagram", "facebook", "website", "google_maps", "recruitment"]
URL_SOURCE_CONFIG = {
    "instagram": {"label": "Instagram", "crawl_limit": SOCIAL_POST_COUNT, "post_limit": SOCIAL_POST_COUNT},
    "facebook": {"label": "Facebook", "crawl_limit": SOCIAL_POST_COUNT, "post_limit": SOCIAL_POST_COUNT},
    "website": {
        "label": "官網",
        "crawl_limit": WEBSITE_CRAWL_LIMIT,
        "max_depth": WEBSITE_MAX_DEPTH,
        "max_seconds": WEBSITE_MAX_SECONDS,
        "exploration": "agentic_site_explorer",
    },
    "google_maps": {"label": "Google 商家/地圖", "crawl_limit": 1},
    "google_reviews": {"label": "Google 評論", "crawl_limit": 1},
    "recruitment": {"label": "招募人才網站", "crawl_limit": 3},
}
WEBSITE_VALUE_KEYWORDS: dict[str, int] = {
    "about": 30,
    "關於": 30,
    "品牌": 28,
    "story": 28,
    "故事": 28,
    "理念": 24,
    "menu": 30,
    "菜單": 30,
    "餐點": 28,
    "產品": 22,
    "品項": 22,
    "news": 20,
    "blog": 18,
    "消息": 18,
    "公告": 18,
    "活動": 18,
    "contact": 24,
    "聯絡": 24,
    "location": 24,
    "store": 24,
    "地址": 24,
    "門市": 22,
    "hours": 18,
    "營業時間": 18,
    "faq": 14,
    "常見問題": 14,
    "reservation": 12,
    "訂位": 12,
    "order": 10,
    "預訂": 10,
}
WEBSITE_LOW_VALUE_KEYWORDS = {
    "login",
    "account",
    "cart",
    "checkout",
    "privacy",
    "terms",
    "policy",
    "cookie",
    "search",
    "member",
    "?餃",
    "?",
    "鞈潛頠?",
    "蝯董",
    "?梁?",
    "璇狡",
    "??",
}
LEGAL_RULE_OPTIONS = [
    "憌?摰銵?蝞∠?瘜?",
    "憌??臬末銵?閬?皞?",
    "憌?摰蝞∪蝟餌絞皞?",
    "憌?瘛餃??拐蝙?函??????刻??潭?皞?",
    "瘨祥??霅瑟?",
    "?砍像鈭斗?瘜?/ 蝬脰楝撱??銝祕?賊?閬?",
    "?犖鞈?靽風瘜?/ ?質?蝝啣?",
    "???箸?瘜?",
    "?瑟平摰銵?瘜?",
    "撱Ｘ??拇???",
]

DEMO_ACCOUNT_KEY = "demo"
DEFAULT_PLAN = "AIR"
PLAN_ORDER = ["FREE", "AIR", "PRO"]
PLAN_CONFIG = {
    "FREE": {
        "name": "FREE",
        "price": "$0/month",
        "features": {
            "diagnosis": "partial",
            "generation": True,
            "brand_image": True,
            "gatekeeper": False,
            "simulation": False,
        },
        "quotas": {"content_generation": 1, "brand_image": 1},
    },
    "AIR": {
        "name": "AIR",
        "price": "$8/month",
        "features": {
            "diagnosis": True,
            "generation": True,
            "brand_image": True,
            "gatekeeper": True,
            "simulation": True,
        },
        "quotas": {"content_generation": 35, "brand_image": 35},
    },
    "PRO": {
        "name": "PRO",
        "price": "$15/month",
        "features": {
            "diagnosis": True,
            "generation": True,
            "brand_image": True,
            "gatekeeper": True,
            "simulation": True,
        },
        "quotas": {"content_generation": None, "brand_image": None},
    },
}

FEATURE_LABELS = {
    "diagnosis": "品牌診斷",
    "generation": "圖文生成",
    "brand_image": "品牌圖片",
    "gatekeeper": "規範檢查",
    "simulation": "市場預測",
    "content_generation": "圖文生成",
}


def utc_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def db_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row else None


def parse_json_field(value: Any, default: Any = None) -> Any:
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def to_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


class FeatureAccessError(RuntimeError):
    def __init__(self, message: str, status_code: int = 403):
        super().__init__(message)
        self.status_code = status_code


class OpenAIConfigurationError(RuntimeError):
    """User-facing OpenAI setup error safe to show in the UI."""


class GlobalScanError(RuntimeError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


def current_week_start() -> str:
    today = datetime.utcnow().date()
    return (today - timedelta(days=today.weekday())).isoformat()


def normalize_plan(value: str | None) -> str:
    plan = (value or DEFAULT_PLAN).upper()
    return plan if plan in PLAN_CONFIG else DEFAULT_PLAN


def get_subscription_row() -> dict[str, Any]:
    init_needed = False
    with db_connect() as conn:
        row = conn.execute("SELECT * FROM subscription_state WHERE id = 1").fetchone()
        if not row:
            init_needed = True
    if init_needed:
        init_db()
    with db_connect() as conn:
        row = conn.execute("SELECT * FROM subscription_state WHERE id = 1").fetchone()
    return row_to_dict(row) or {
        "id": 1,
        "account_key": DEMO_ACCOUNT_KEY,
        "plan": DEFAULT_PLAN,
        "updated_at": utc_now(),
    }


def set_subscription_plan(plan: str) -> dict[str, Any]:
    normalized = normalize_plan(plan)
    if normalized not in PLAN_CONFIG:
        raise FeatureAccessError("Unknown plan.", 400)
    with db_connect() as conn:
        conn.execute(
            """
            INSERT INTO subscription_state (id, account_key, plan, updated_at)
            VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET plan = excluded.plan, updated_at = excluded.updated_at
            """,
            (DEMO_ACCOUNT_KEY, normalized, utc_now()),
        )
    return get_subscription_row()


def weekly_usage_counts(brand_id: int | None = None) -> dict[str, int]:
    brand_id = brand_id or default_brand_id()
    with db_connect() as conn:
        rows = conn.execute(
            """
            SELECT feature, COALESCE(SUM(units), 0) AS used
            FROM usage_events
            WHERE account_key = ? AND brand_id = ? AND period_start = ?
            GROUP BY feature
            """,
            (DEMO_ACCOUNT_KEY, brand_id, current_week_start()),
        ).fetchall()
    return {row["feature"]: int(row["used"]) for row in rows}


def subscription_payload(brand_id: int | None = None) -> dict[str, Any]:
    brand_id = brand_id or default_brand_id()
    row = get_subscription_row()
    plan = normalize_plan(row.get("plan"))
    config = PLAN_CONFIG[plan]
    used = weekly_usage_counts(brand_id)
    quotas = {}
    for feature, limit in config["quotas"].items():
        count = used.get(feature, 0)
        quotas[feature] = {
            "limit": limit,
            "used": count,
            "remaining": None if limit is None else max(0, int(limit) - count),
        }
    return {
        "account_key": row.get("account_key", DEMO_ACCOUNT_KEY),
        "plan": plan,
        "plan_info": {
            "name": config["name"],
            "price": config["price"],
            "features": config["features"],
        },
        "period": {"type": "weekly", "start": current_week_start()},
        "quotas": quotas,
        "usage": used,
        "plans": PLAN_CONFIG,
    }


def require_feature_access(capability: str, usage_feature: str | None = None) -> dict[str, Any]:
    state = subscription_payload()
    plan = state["plan"]
    features = PLAN_CONFIG[plan]["features"]
    if not features.get(capability):
        label = FEATURE_LABELS.get(capability, capability)
        raise FeatureAccessError(f"{label} is not available on the {plan} plan.", 403)
    if usage_feature:
        quota = state["quotas"].get(usage_feature)
        if quota and quota["limit"] is not None and quota["remaining"] <= 0:
            label = FEATURE_LABELS.get(usage_feature, usage_feature)
            raise FeatureAccessError(f"{label} weekly quota has been used up for the {plan} plan.", 429)
    return state


def record_usage_event(feature: str, units: int = 1, metadata: dict[str, Any] | None = None) -> None:
    brand_id = default_brand_id()
    plan = normalize_plan(get_subscription_row().get("plan"))
    with db_connect() as conn:
        conn.execute(
            """
            INSERT INTO usage_events
            (account_key, brand_id, feature, plan, units, period_start, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                DEMO_ACCOUNT_KEY,
                brand_id,
                feature,
                plan,
                units,
                current_week_start(),
                to_json(metadata or {}),
                utc_now(),
            ),
        )


def access_error_response(exc: FeatureAccessError):
    return api_error(str(exc), exc.status_code, subscription=subscription_payload())


def init_db() -> None:
    DATA_FOLDER.mkdir(parents=True, exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db_connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS brands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                handle TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                category TEXT,
                location TEXT,
                description TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS raw_sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand_id INTEGER NOT NULL,
                source_type TEXT NOT NULL,
                input_kind TEXT NOT NULL,
                title TEXT,
                url TEXT,
                original_filename TEXT,
                raw_path TEXT,
                mime_type TEXT,
                status TEXT NOT NULL DEFAULT 'stored',
                metadata_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (brand_id) REFERENCES brands(id)
            );

            CREATE TABLE IF NOT EXISTS extraction_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id INTEGER NOT NULL,
                brand_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                extracted_text TEXT,
                artifact_path TEXT,
                error TEXT,
                metadata_json TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (source_id) REFERENCES raw_sources(id),
                FOREIGN KEY (brand_id) REFERENCES brands(id)
            );

            CREATE TABLE IF NOT EXISTS analysis_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id INTEGER NOT NULL,
                brand_id INTEGER NOT NULL,
                analysis_type TEXT NOT NULL,
                status TEXT NOT NULL,
                result_json TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (source_id) REFERENCES raw_sources(id),
                FOREIGN KEY (brand_id) REFERENCES brands(id)
            );

            CREATE TABLE IF NOT EXISTS brand_dna_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand_id INTEGER NOT NULL,
                result_json TEXT NOT NULL,
                manual_overrides_json TEXT,
                source_result_ids_json TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                FOREIGN KEY (brand_id) REFERENCES brands(id)
            );

            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand_id INTEGER NOT NULL,
                job_type TEXT NOT NULL,
                status TEXT NOT NULL,
                input_json TEXT,
                result_json TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                FOREIGN KEY (brand_id) REFERENCES brands(id)
            );

            CREATE TABLE IF NOT EXISTS artifacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand_id INTEGER NOT NULL,
                job_id INTEGER,
                artifact_type TEXT NOT NULL,
                title TEXT,
                payload_json TEXT,
                file_path TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (brand_id) REFERENCES brands(id),
                FOREIGN KEY (job_id) REFERENCES jobs(id)
            );

            CREATE TABLE IF NOT EXISTS subscription_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                account_key TEXT NOT NULL,
                plan TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS usage_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_key TEXT NOT NULL,
                brand_id INTEGER NOT NULL,
                feature TEXT NOT NULL,
                plan TEXT NOT NULL,
                units INTEGER NOT NULL DEFAULT 1,
                period_start TEXT NOT NULL,
                metadata_json TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (brand_id) REFERENCES brands(id)
            );

            CREATE TABLE IF NOT EXISTS system_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand_id INTEGER,
                job_id INTEGER,
                source_id INTEGER,
                request_id TEXT,
                level TEXT NOT NULL,
                event_type TEXT NOT NULL,
                stage TEXT,
                message TEXT NOT NULL,
                details_json TEXT,
                duration_ms INTEGER,
                error TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_system_logs_job ON system_logs(job_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_system_logs_source ON system_logs(source_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level, created_at);
            """
        )
        now = utc_now()
        conn.execute(
            """
            INSERT OR IGNORE INTO brands
            (handle, name, category, location, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                DEFAULT_BRAND["handle"],
                DEFAULT_BRAND["name"],
                DEFAULT_BRAND["category"],
                DEFAULT_BRAND["location"],
                DEFAULT_BRAND["description"],
                now,
                now,
            ),
        )
        conn.execute(
            """
            UPDATE brands
            SET name = ?, category = ?, location = ?, description = ?, updated_at = ?
            WHERE handle = ? AND name LIKE ?
            """,
            (
                "?拐??拙?擗?",
                "?啁擗ㄡ??",
                "?啣?撣葉撅勗?",
                "隞交澈??璆准敦?拍??拙?擗???詨?嚗? BrandDNA 蝬剜???皞??湔扼?",
                now,
                DEFAULT_BRAND["handle"],
                "%嚙?",
            ),
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO subscription_state
            (id, account_key, plan, updated_at)
            VALUES (1, ?, ?, ?)
            """,
            (DEMO_ACCOUNT_KEY, DEFAULT_PLAN, now),
        )


def default_brand_id() -> int:
    with db_connect() as conn:
        row = conn.execute("SELECT id FROM brands WHERE handle = ?", (DEFAULT_BRAND["handle"],)).fetchone()
        if row:
            return int(row["id"])
    init_db()
    with db_connect() as conn:
        row = conn.execute("SELECT id FROM brands WHERE handle = ?", (DEFAULT_BRAND["handle"],)).fetchone()
        return int(row["id"])


def require_openai_client(feature: str = "AI feature"):
    if OpenAI is None:
        raise OpenAIConfigurationError(f"{feature} requires the OpenAI Python SDK. Run pip install -r requirements.txt.")
    if openai_client is None:
        if raw_openai_api_key and normalize_openai_api_key(raw_openai_api_key) is None:
            raise OpenAIConfigurationError(
                f"{feature} cannot run because OPENAI_API_KEY is still the sample placeholder in .env. "
                "Replace it with a valid OpenAI API key, restart the Flask server, then retry analysis."
            )
        raise OpenAIConfigurationError(
            f"{feature} requires OPENAI_API_KEY in .env. Set a valid OpenAI API key, restart the Flask server, then retry analysis."
        )
    return openai_client


def user_safe_openai_error(exc: Exception) -> Exception:
    message = str(exc)
    lowered = message.lower()
    if "invalid_api_key" in lowered or "incorrect api key" in lowered or "401" in lowered:
        return OpenAIConfigurationError(
            "OPENAI_API_KEY is invalid. Replace it with a valid OpenAI API key in .env, "
            "restart the Flask server, then retry analysis."
        )
    return exc

def parse_json_response(text: str) -> Any:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        starts = [i for i in (cleaned.find("{"), cleaned.find("[")) if i != -1]
        ends = [i for i in (cleaned.rfind("}"), cleaned.rfind("]")) if i != -1]
        if not starts or not ends:
            raise
        return json.loads(cleaned[min(starts) : max(ends) + 1])


def openai_model_for(task: str | None = None) -> str:
    return OPENAI_MODELS.get(task or "default") or OPENAI_MODELS["default"]


def openai_reasoning_for(task: str | None = None) -> dict[str, str] | None:
    effort = str(OPENAI_REASONING_EFFORT.get(task or "default") or OPENAI_REASONING_EFFORT["default"]).strip()
    if effort.lower() in OPENAI_REASONING_DISABLED_VALUES:
        return None
    return {"effort": effort}


def add_openai_reasoning(payload: dict[str, Any], task: str | None = None) -> dict[str, Any]:
    reasoning = openai_reasoning_for(task)
    if reasoning:
        payload["reasoning"] = reasoning
    return payload


def openai_verbosity_for(task: str | None = None) -> str:
    return OPENAI_VERBOSITY.get(task or "default") or OPENAI_VERBOSITY["default"]


def openai_image_detail_for(task: str | None = None) -> str:
    return OPENAI_IMAGE_DETAIL.get(task or "default") or OPENAI_IMAGE_DETAIL["default"]


def openai_instructions_for(task: str | None, system_instruction: str, *, json_output: bool) -> str:
    parts = [
        OPENAI_BASE_PROMPT_CONTRACT,
        OPENAI_JSON_PROMPT_CONTRACT if json_output else OPENAI_TEXT_PROMPT_CONTRACT,
        OPENAI_TASK_PROMPT_CONTRACTS.get(task or "", ""),
        (system_instruction or "").strip(),
    ]
    return "\n\n".join(part for part in parts if part)


def response_output_text(response: Any) -> str:
    text = getattr(response, "output_text", None)
    if text:
        return str(text).strip()
    chunks: list[str] = []
    for output in getattr(response, "output", []) or []:
        for item in getattr(output, "content", []) or []:
            item_text = getattr(item, "text", None)
            if item_text:
                chunks.append(str(item_text))
    return "\n".join(chunks).strip()


def nested_response_value(value: Any, *keys: str) -> Any:
    current = value
    for key in keys:
        if current is None:
            return None
        if isinstance(current, dict):
            current = current.get(key)
        else:
            current = getattr(current, key, None)
    return current


def int_or_zero(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def normalized_openai_pricing_tier(service_tier: Any) -> str:
    tier = str(service_tier or "default").strip().lower()
    return OPENAI_SERVICE_TIER_PRICING_ALIASES.get(tier, "standard")


def openai_pricing_for_model(model: str | None, service_tier: Any = None) -> tuple[str, dict[str, float | None] | None]:
    model_id = str(model or "").strip()
    pricing_tier = normalized_openai_pricing_tier(service_tier)
    tier_prices = OPENAI_TOKEN_PRICING_PER_1M_USD.get(pricing_tier) or OPENAI_TOKEN_PRICING_PER_1M_USD["standard"]
    matched_model = None
    if model_id in tier_prices:
        matched_model = model_id
    else:
        for candidate in sorted(tier_prices, key=len, reverse=True):
            if model_id == candidate:
                matched_model = candidate
                break
            if model_id.startswith(f"{candidate}-"):
                suffix_head = model_id[len(candidate) + 1 :].split("-", 1)[0].lower()
                if suffix_head in OPENAI_MODEL_VARIANT_SUFFIXES:
                    continue
                matched_model = candidate
                break
    if not matched_model:
        return pricing_tier, None
    input_rate, cached_rate, output_rate = tier_prices[matched_model]
    return pricing_tier, {
        "model": matched_model,
        "input_per_1m": input_rate,
        "cached_input_per_1m": cached_rate,
        "output_per_1m": output_rate,
    }


def openai_usage_from_response(response: Any, payload: dict[str, Any]) -> dict[str, Any] | None:
    usage = getattr(response, "usage", None)
    if usage is None:
        return None
    input_tokens = int_or_zero(nested_response_value(usage, "input_tokens"))
    cached_input_tokens = int_or_zero(nested_response_value(usage, "input_tokens_details", "cached_tokens"))
    output_tokens = int_or_zero(nested_response_value(usage, "output_tokens"))
    reasoning_tokens = int_or_zero(nested_response_value(usage, "output_tokens_details", "reasoning_tokens"))
    total_tokens = int_or_zero(nested_response_value(usage, "total_tokens")) or input_tokens + output_tokens
    if not any((input_tokens, output_tokens, total_tokens)):
        return None

    model = getattr(response, "model", None) or payload.get("model")
    service_tier = getattr(response, "service_tier", None) or payload.get("service_tier") or "default"
    pricing_tier, rates = openai_pricing_for_model(model, service_tier)
    cost_usd = None
    pricing_model = None
    if rates:
        pricing_model = rates["model"]
        cached_rate = rates["cached_input_per_1m"] if rates["cached_input_per_1m"] is not None else rates["input_per_1m"]
        uncached_input_tokens = max(0, input_tokens - cached_input_tokens)
        cost_usd = (
            (uncached_input_tokens * float(rates["input_per_1m"]))
            + (cached_input_tokens * float(cached_rate))
            + (output_tokens * float(rates["output_per_1m"]))
        ) / 1_000_000

    return {
        "model": model,
        "pricing_model": pricing_model,
        "service_tier": service_tier,
        "pricing_tier": pricing_tier,
        "input_tokens": input_tokens,
        "cached_input_tokens": cached_input_tokens,
        "output_tokens": output_tokens,
        "reasoning_tokens": reasoning_tokens,
        "total_tokens": total_tokens,
        "cost_usd": cost_usd,
        "rates_per_1m_usd": rates,
    }


def record_openai_response_usage(response: Any, payload: dict[str, Any]) -> None:
    if not has_request_context():
        return
    usage = openai_usage_from_response(response, payload)
    if not usage:
        return
    if not hasattr(g, "openai_usage_events"):
        g.openai_usage_events = []
    g.openai_usage_events.append(usage)


def current_request_openai_usage() -> dict[str, Any] | None:
    if not has_request_context():
        return None
    events = list(getattr(g, "openai_usage_events", []) or [])
    if not events:
        return None
    total_cost = 0.0
    has_unknown_cost = False
    for event in events:
        if event.get("cost_usd") is None:
            has_unknown_cost = True
        else:
            total_cost += float(event["cost_usd"])
    return {
        "calls": len(events),
        "input_tokens": sum(int_or_zero(event.get("input_tokens")) for event in events),
        "cached_input_tokens": sum(int_or_zero(event.get("cached_input_tokens")) for event in events),
        "output_tokens": sum(int_or_zero(event.get("output_tokens")) for event in events),
        "reasoning_tokens": sum(int_or_zero(event.get("reasoning_tokens")) for event in events),
        "total_tokens": sum(int_or_zero(event.get("total_tokens")) for event in events),
        "cost_usd": None if has_unknown_cost else round(total_cost, 10),
        "currency": "USD",
        "pricing_note": "Calculated from OpenAI response.usage and published per-1M-token rates.",
        "items": events,
    }


def is_unsupported_openai_parameter_error(exc: Exception, parameter: str) -> bool:
    message = str(exc).lower()
    needle = parameter.lower()
    return "unsupported parameter" in message and needle in message


def create_openai_response(client: Any, payload: dict[str, Any], *, temperature: float | None = None) -> Any:
    request_payload = dict(payload)
    if temperature is not None:
        request_payload["temperature"] = temperature
    try:
        response = client.responses.create(**request_payload)
        record_openai_response_usage(response, request_payload)
        return response
    except Exception as exc:
        if temperature is not None and is_unsupported_openai_parameter_error(exc, "temperature"):
            retry_payload = dict(request_payload)
            retry_payload.pop("temperature", None)
            try:
                response = client.responses.create(**retry_payload)
                record_openai_response_usage(response, retry_payload)
                return response
            except Exception as retry_exc:
                raise user_safe_openai_error(retry_exc) from retry_exc
        raise user_safe_openai_error(exc) from exc


def generate_openai_json(
    prompt: Any,
    system_instruction: str,
    temperature: float = 0.2,
    max_output_tokens: int = 4096,
    task: str = "default",
    model: str | None = None,
) -> Any:
    client = require_openai_client("AI JSON generation")
    response = create_openai_response(
        client,
        add_openai_reasoning({
            "model": model or openai_model_for(task),
            "instructions": openai_instructions_for(task, system_instruction, json_output=True),
            "input": prompt,
            "text": {"format": {"type": "json_object"}, "verbosity": openai_verbosity_for(task)},
            "max_output_tokens": max_output_tokens,
            "store": False,
        }, task),
        temperature=temperature,
    )
    return parse_json_response(response_output_text(response))


def generate_openai_text(
    contents: Any,
    system_instruction: str,
    temperature: float = 0.1,
    task: str = "default",
    model: str | None = None,
) -> str:
    client = require_openai_client("AI text generation")
    response = create_openai_response(
        client,
        add_openai_reasoning({
            "model": model or openai_model_for(task),
            "instructions": openai_instructions_for(task, system_instruction, json_output=False),
            "input": contents,
            "text": {"format": {"type": "text"}, "verbosity": openai_verbosity_for(task)},
            "store": False,
        }, task),
        temperature=temperature,
    )
    return response_output_text(response)

def attach_current_openai_usage(payload: dict[str, Any]) -> dict[str, Any]:
    if "ai_usage" not in payload:
        ai_usage = current_request_openai_usage()
        if ai_usage:
            payload["ai_usage"] = ai_usage
    return payload


def api_result(success: bool, status_code: int = 200, **payload: Any):
    payload = attach_current_openai_usage(payload)
    response = jsonify({"success": success, **payload})
    return response if status_code == 200 else (response, status_code)


def api_success(**payload: Any):
    return api_result(True, **payload)


def api_error(message: str, status_code: int = 400, **payload: Any):
    level = "error" if status_code >= 500 else "warning"
    log_event(
        level,
        "api.error",
        message,
        stage=request.endpoint if has_request_context() else None,
        details={"status_code": status_code, "path": request.path if has_request_context() else None},
        error=message,
    )
    return api_result(False, status_code, error=message, **payload)


def current_request_id() -> str | None:
    if not has_request_context():
        return None
    request_id = getattr(g, "request_id", None)
    if not request_id:
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
        g.request_id = request_id
    return request_id


def compact_log_value(value: Any, *, depth: int = 0) -> Any:
    if depth > 3:
        return "<truncated>"
    if isinstance(value, str):
        return value if len(value) <= 1200 else value[:1200] + "...<truncated>"
    if isinstance(value, list):
        return [compact_log_value(item, depth=depth + 1) for item in value[:20]]
    if isinstance(value, dict):
        return {str(key): compact_log_value(item, depth=depth + 1) for key, item in list(value.items())[:40]}
    return value


def log_event(
    level: str,
    event_type: str,
    message: str,
    *,
    brand_id: int | None = None,
    job_id: int | None = None,
    source_id: int | None = None,
    stage: str | None = None,
    details: dict[str, Any] | None = None,
    duration_ms: int | None = None,
    error: str | None = None,
) -> None:
    created_at = utc_now()
    request_id = current_request_id()
    details = compact_log_value(details or {})
    error = compact_log_value(error) if error else None
    row = {
        "brand_id": brand_id,
        "job_id": job_id,
        "source_id": source_id,
        "request_id": request_id,
        "level": level,
        "event_type": event_type,
        "stage": stage,
        "message": message,
        "details": details,
        "duration_ms": duration_ms,
        "error": error,
        "created_at": created_at,
    }
    try:
        with db_connect() as conn:
            conn.execute(
                """
                INSERT INTO system_logs
                (brand_id, job_id, source_id, request_id, level, event_type, stage, message,
                 details_json, duration_ms, error, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    brand_id,
                    job_id,
                    source_id,
                    request_id,
                    level,
                    event_type,
                    stage,
                    message,
                    to_json(details),
                    duration_ms,
                    error,
                    created_at,
                ),
            )
    except Exception:
        pass
    try:
        LOG_FOLDER.mkdir(parents=True, exist_ok=True)
        with SYSTEM_LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(to_json(row) + "\n")
    except Exception:
        pass


def safe_relative_path(path: Path | None) -> str | None:
    if not path:
        return None
    try:
        return str(path.resolve().relative_to(BASE_DIR))
    except ValueError:
        return str(path)


def absolute_stored_path(stored_path: str | None) -> Path | None:
    if not stored_path:
        return None
    path = Path(stored_path)
    if path.is_absolute():
        return path
    return BASE_DIR / path


def unique_file_path(folder: Path, filename: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    safe = secure_filename(filename) or "rawdata.txt"
    return folder / f"{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}_{safe}"


def normalize_url(value: Any) -> str | None:
    url = str(value or "").strip()
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return url


def source_type_label(source_type: str) -> str:
    return URL_SOURCE_CONFIG.get(source_type, {}).get("label", source_type)


def collect_global_scan_urls(payload: dict[str, Any]) -> tuple[dict[str, str], list[dict[str, str]]]:
    raw_urls = payload.get("urls") or {}
    urls: dict[str, str] = {}
    invalid: list[dict[str, str]] = []
    for source_type in GLOBAL_SCAN_URL_SOURCE_TYPES:
        value = raw_urls.get(source_type)
        if not str(value or "").strip():
            continue
        normalized = normalize_url(value)
        if normalized:
            urls[source_type] = normalized
        else:
            invalid.append({"source_type": source_type, "url": str(value or "").strip()})
    return urls, invalid


def collect_global_scan_sources(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    if isinstance(payload.get("source_specs"), list):
        return [dict(item) for item in payload["source_specs"] if isinstance(item, dict)], []

    urls, invalid = collect_global_scan_urls(payload)
    specs = [
        {
            "source_type": source_type,
            "input_kind": "url",
            "url": url,
            "title": f"{source_type_label(source_type)} URL 擷取",
            "metadata": {"source_input_mode": "url"},
        }
        for source_type, url in urls.items()
    ]
    return specs, invalid


def collect_global_scan_sources_from_form(form, files) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    specs: list[dict[str, Any]] = []
    invalid: list[dict[str, str]] = []
    for source_type in GLOBAL_SCAN_URL_SOURCE_TYPES:
        spec, invalid_item = collect_single_source_spec_from_form(source_type, form, files)
        if invalid_item:
            invalid.append(invalid_item)
        if spec:
            specs.append(spec)
    return specs, invalid


def build_auto_social_posts_payload(source_type: str, form) -> tuple[str, dict[str, Any]] | None:
    contents = [
        str(form.get(f"{source_type}_auto_post_content_{index}") or "").strip()
        for index in range(1, SOCIAL_POST_COUNT + 1)
    ]
    if not any(contents):
        return None
    if not all(contents):
        missing = [str(index) for index, content in enumerate(contents, start=1) if not content]
        raise ValueError(f"{source_type_label(source_type)} 自動擷取貼文尚未完整，缺少第 {', '.join(missing)} 篇。")
    content_blocks = [f"{source_type_label(source_type)} 自動擷取貼文，共 {SOCIAL_POST_COUNT} 篇"]
    saved_posts: list[dict[str, Any]] = []
    for index, content in enumerate(contents, start=1):
        saved_posts.append({"index": index, "source": "auto_preview"})
        content_blocks.append(f"## Post {index}\n{content}")
    return (
        "\n\n".join(content_blocks).strip(),
        {
            "auto_social_posts": saved_posts,
            "auto_post_count": SOCIAL_POST_COUNT,
        },
    )


def collect_single_source_spec_from_form(source_type: str, form, files) -> tuple[dict[str, Any] | None, dict[str, str] | None]:
    mode = str(form.get(f"{source_type}_mode") or "").strip().lower()
    if mode not in {"url", "manual"}:
        mode = "manual" if source_type in SOCIAL_POST_SOURCE_TYPES else "url"

    if mode == "url":
        raw_url = str(form.get(f"{source_type}_url") or "").strip()
        if not raw_url:
            return None, None
        normalized = normalize_url(raw_url)
        if not normalized:
            return None, {"source_type": source_type, "url": raw_url}
        if source_type in SOCIAL_POST_SOURCE_TYPES:
            auto_payload = build_auto_social_posts_payload(source_type, form)
            if auto_payload:
                content, auto_metadata = auto_payload
                return (
                    {
                        "source_type": source_type,
                        "input_kind": "text",
                        "url": normalized,
                        "title": str(form.get(f"{source_type}_title") or "").strip()
                        or f"{source_type_label(source_type)} 自動擷取貼文",
                        "content": content,
                        "metadata": {
                            **auto_metadata,
                            "source_input_mode": "url",
                            "automation": "social_preview_in_source_input",
                            "source_url": normalized,
                        },
                    },
                    None,
                )
        return (
            {
                "source_type": source_type,
                "input_kind": "url",
                "url": normalized,
                "title": f"{source_type_label(source_type)} URL 擷取",
                "metadata": {"source_input_mode": "url"},
            },
            None,
        )

    if source_type in SOCIAL_POST_SOURCE_TYPES:
        manual_payload = build_manual_social_posts_payload(source_type, form, files, prefix=f"{source_type}_")
        if not manual_payload:
            return None, None
        content, social_metadata = manual_payload
        return (
            {
                "source_type": source_type,
                "input_kind": "text",
                "url": normalize_url(form.get(f"{source_type}_url")),
                "title": str(form.get(f"{source_type}_title") or "").strip()
                or f"{source_type_label(source_type)} 手動貼文",
                "content": content,
                "metadata": {
                    **social_metadata,
                    "source_input_mode": "manual",
                    "automation": "manual_in_global_scan",
                },
            },
            None,
        )

    content = str(form.get(f"{source_type}_content") or "").strip()
    if not content:
        return None, None
    return (
        {
            "source_type": source_type,
            "input_kind": "text",
            "url": normalize_url(form.get(f"{source_type}_url")),
            "title": str(form.get(f"{source_type}_title") or "").strip()
            or f"{source_type_label(source_type)} 手動輸入",
            "content": content,
            "metadata": {
                "source_input_mode": "manual",
                "automation": "manual_in_global_scan",
            },
        },
        None,
    )


def create_source_from_spec(brand_id: int, spec: dict[str, Any], *, job_id: int | None = None) -> int:
    source_type = str(spec.get("source_type") or "custom")
    input_kind = str(spec.get("input_kind") or "url")
    url = spec.get("url")
    title = spec.get("title") or (
        f"{source_type_label(source_type)} 手動輸入"
        if input_kind == "text"
        else f"{source_type_label(source_type)} URL 擷取"
    )
    source_metadata = {
        **(spec.get("metadata") if isinstance(spec.get("metadata"), dict) else {}),
        "source_url_kind": source_type,
    }
    if job_id is not None:
        source_metadata.setdefault("global_scan_id", job_id)
    if input_kind == "text":
        return create_text_source(
            brand_id,
            source_type,
            title,
            str(spec.get("content") or ""),
            url=url,
            metadata=source_metadata,
        )
    return insert_raw_source(
        brand_id,
        source_type,
        "url",
        title,
        url=url,
        metadata=source_metadata,
    )


def process_single_source_spec(brand_id: int, spec: dict[str, Any]) -> dict[str, Any]:
    source_id = create_source_from_spec(brand_id, spec)
    extraction = extract_source_content(source_id)
    analysis = None
    if extraction["status"] == "extracted":
        try:
            analysis = analyze_source_content(source_id)
        except Exception as exc:
            source = fetch_source(source_id) or {}
            analysis = create_analysis_result(source, "error", error=str(exc))
    return {
        "source": serialize_source(fetch_source(source_id) or {}),
        "extraction": extraction,
        "analysis": analysis,
    }


def normalize_selected_rules(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    normalized = []
    for item in value:
        rule = str(item or "").strip()
        if rule and rule not in normalized:
            normalized.append(rule)
    return normalized


def create_text_source(
    brand_id: int,
    source_type: str,
    title: str,
    content: str,
    *,
    url: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> int:
    path = unique_file_path(RAWDATA_FOLDER / "text", f"{source_type}.txt")
    path.write_text(content, encoding="utf-8")
    return insert_raw_source(
        brand_id,
        source_type,
        "text",
        title,
        url=url,
        raw_path=safe_relative_path(path),
        mime_type="text/plain",
        metadata=metadata or {},
    )


def build_manual_social_posts_payload(source_type: str, form, files, prefix: str = "") -> tuple[str, dict[str, Any]] | None:
    has_social_post_fields = any(
        str(form.get(f"{prefix}post_content_{index}") or "").strip() or files.get(f"{prefix}post_image_{index}")
        for index in range(1, SOCIAL_POST_COUNT + 1)
    )
    if not has_social_post_fields:
        return None
    if source_type not in SOCIAL_POST_SOURCE_TYPES:
        raise ValueError("手動貼文輸入僅支援 Instagram 或 Facebook。")

    missing: list[str] = []
    invalid: list[str] = []
    prepared_posts: list[dict[str, Any]] = []
    for index in range(1, SOCIAL_POST_COUNT + 1):
        content = str(form.get(f"{prefix}post_content_{index}") or "").strip()
        image = files.get(f"{prefix}post_image_{index}")
        if not content:
            missing.append(f"第 {index} 篇內容")
        if not image or not image.filename:
            missing.append(f"第 {index} 篇圖片")
        else:
            suffix = Path(image.filename).suffix.lower()
            if suffix not in IMAGE_EXTENSIONS:
                invalid.append(f"第 {index} 篇圖片格式不支援")
        prepared_posts.append({"index": index, "content": content, "image": image})

    if missing or invalid:
        problems = missing + invalid
        raise ValueError(f"{source_type_label(source_type)} 手動輸入需要 5 篇貼文內容與 5 張圖片：{', '.join(problems)}。")

    folder = RAWDATA_FOLDER / "manual_social_images" / source_type
    saved_posts: list[dict[str, Any]] = []
    content_blocks: list[str] = [f"{source_type_label(source_type)} 手動輸入貼文，共 {SOCIAL_POST_COUNT} 篇"]
    for post in prepared_posts:
        image = post["image"]
        original_filename = image.filename
        mime_type = image.mimetype or mimetypes.guess_type(original_filename)[0]
        path = unique_file_path(folder, original_filename)
        image.save(path)
        relative_path = safe_relative_path(path)
        saved_posts.append(
            {
                "index": post["index"],
                "image_path": relative_path,
                "original_filename": original_filename,
                "mime_type": mime_type,
            }
        )
        content_blocks.append(
            f"## Post {post['index']}\n"
            f"{post['content']}\n"
            f"Image filename: {original_filename}\n"
            f"Image path: {relative_path}"
        )

    return (
        "\n\n".join(content_blocks).strip(),
        {
            "manual_social_posts": saved_posts,
            "manual_post_count": SOCIAL_POST_COUNT,
            "manual_image_count": len(saved_posts),
        },
    )


def insert_raw_source(
    brand_id: int,
    source_type: str,
    input_kind: str,
    title: str | None,
    *,
    url: str | None = None,
    original_filename: str | None = None,
    raw_path: str | None = None,
    mime_type: str | None = None,
    status: str = "stored",
    metadata: dict[str, Any] | None = None,
) -> int:
    now = utc_now()
    with db_connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO raw_sources
            (brand_id, source_type, input_kind, title, url, original_filename, raw_path, mime_type,
             status, metadata_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                brand_id,
                source_type,
                input_kind,
                title,
                url,
                original_filename,
                raw_path,
                mime_type,
                status,
                to_json(metadata or {}),
                now,
                now,
            ),
        )
        source_id = int(cur.lastrowid)
    log_event(
        "info",
        "source.created",
        f"Created {source_type} source #{source_id}.",
        brand_id=brand_id,
        source_id=source_id,
        stage="source",
        details={"source_type": source_type, "input_kind": input_kind, "title": title, "url": url, "status": status},
    )
    return source_id


def update_source_status(source_id: int, status: str) -> None:
    with db_connect() as conn:
        conn.execute(
            "UPDATE raw_sources SET status = ?, updated_at = ? WHERE id = ?",
            (status, utc_now(), source_id),
        )


def fetch_source(source_id: int) -> dict[str, Any] | None:
    with db_connect() as conn:
        row = conn.execute("SELECT * FROM raw_sources WHERE id = ?", (source_id,)).fetchone()
    return row_to_dict(row)


def latest_extraction(source_id: int) -> dict[str, Any] | None:
    with db_connect() as conn:
        row = conn.execute(
            "SELECT * FROM extraction_results WHERE source_id = ? ORDER BY id DESC LIMIT 1",
            (source_id,),
        ).fetchone()
    return row_to_dict(row)


def latest_analysis(source_id: int) -> dict[str, Any] | None:
    with db_connect() as conn:
        row = conn.execute(
            "SELECT * FROM analysis_results WHERE source_id = ? ORDER BY id DESC LIMIT 1",
            (source_id,),
        ).fetchone()
    return row_to_dict(row)


def create_extraction_result(
    source: dict[str, Any],
    status: str,
    extracted_text: str = "",
    *,
    artifact_path: str | None = None,
    error: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    with db_connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO extraction_results
            (source_id, brand_id, status, extracted_text, artifact_path, error, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                source["id"],
                source["brand_id"],
                status,
                extracted_text,
                artifact_path,
                error,
                to_json(metadata or {}),
                utc_now(),
            ),
        )
        result_id = int(cur.lastrowid)
    update_source_status(source["id"], status)
    log_event(
        "info" if status == "extracted" else "warning" if status == "needs_manual_text" else "error",
        "extract.completed" if status == "extracted" else "extract.failed",
        f"Extraction {status} for source #{source['id']}.",
        brand_id=source["brand_id"],
        source_id=source["id"],
        stage="extract",
        details={
            "status": status,
            "source_type": source.get("source_type"),
            "input_kind": source.get("input_kind"),
            "char_count": len(extracted_text or ""),
            "artifact_path": artifact_path,
            "metadata": metadata or {},
        },
        error=error,
    )
    return {
        "id": result_id,
        "source_id": source["id"],
        "status": status,
        "extracted_text": extracted_text,
        "artifact_path": artifact_path,
        "error": error,
        "metadata": metadata or {},
    }


def create_analysis_result(
    source: dict[str, Any],
    status: str,
    result: dict[str, Any] | None = None,
    *,
    error: str | None = None,
) -> dict[str, Any]:
    with db_connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO analysis_results
            (source_id, brand_id, analysis_type, status, result_json, error, created_at)
            VALUES (?, ?, 'personality', ?, ?, ?, ?)
            """,
            (source["id"], source["brand_id"], status, to_json(result or {}), error, utc_now()),
        )
        result_id = int(cur.lastrowid)
    log_event(
        "info" if status == "analyzed" else "error",
        "analyze.completed" if status == "analyzed" else "analyze.failed",
        f"Analysis {status} for source #{source['id']}.",
        brand_id=source["brand_id"],
        source_id=source["id"],
        stage="analyze",
        details={
            "status": status,
            "source_type": source.get("source_type"),
            "analysis_type": "personality",
            "result_keys": sorted((result or {}).keys()),
        },
        error=error,
    )
    return {
        "id": result_id,
        "source_id": source["id"],
        "status": status,
        "result": result or {},
        "error": error,
    }


def create_job(brand_id: int, job_type: str, input_data: dict[str, Any] | None = None) -> int:
    with db_connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO jobs (brand_id, job_type, status, input_json, created_at)
            VALUES (?, ?, 'queued', ?, ?)
            """,
            (brand_id, job_type, to_json(input_data or {}), utc_now()),
        )
        job_id = int(cur.lastrowid)
    log_event(
        "info",
        "job.created",
        f"Created {job_type} job #{job_id}.",
        brand_id=brand_id,
        job_id=job_id,
        stage="job",
        details={"job_type": job_type, "input": input_data or {}},
    )
    return job_id


def update_job(
    job_id: int,
    status: str,
    *,
    result: dict[str, Any] | None = None,
    error: str | None = None,
    mark_started: bool = False,
    mark_finished: bool = False,
) -> None:
    fields = ["status = ?", "result_json = ?", "error = ?"]
    values: list[Any] = [status, to_json(result) if result is not None else None, error]
    if mark_started:
        fields.append("started_at = COALESCE(started_at, ?)")
        values.append(utc_now())
    if mark_finished:
        fields.append("finished_at = ?")
        values.append(utc_now())
    values.append(job_id)
    with db_connect() as conn:
        conn.execute(f"UPDATE jobs SET {', '.join(fields)} WHERE id = ?", values)
        row = conn.execute("SELECT brand_id, job_type FROM jobs WHERE id = ?", (job_id,)).fetchone()
    log_event(
        "info" if status in {"queued", "running", "done"} else "error",
        "job.status_changed",
        f"Job #{job_id} changed to {status}.",
        brand_id=row["brand_id"] if row else None,
        job_id=job_id,
        stage="job",
        details={"status": status, "job_type": row["job_type"] if row else None, "has_result": result is not None},
        error=error,
    )


def fetch_job(job_id: int) -> dict[str, Any] | None:
    with db_connect() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    job = row_to_dict(row)
    if job:
        job["input"] = parse_json_field(job.pop("input_json"), {})
        job["result"] = parse_json_field(job.pop("result_json"), None)
    return job


def serialize_log(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = row_to_dict(row) if isinstance(row, sqlite3.Row) else dict(row)
    if not item:
        return {}
    item["details"] = parse_json_field(item.pop("details_json", None), {})
    return item


def fetch_system_logs(
    *,
    brand_id: int | None = None,
    job_id: int | None = None,
    source_id: int | None = None,
    level: str | None = None,
    event_type: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    values: list[Any] = []
    if brand_id is not None:
        clauses.append("(brand_id = ? OR brand_id IS NULL)")
        values.append(brand_id)
    if job_id is not None:
        clauses.append("job_id = ?")
        values.append(job_id)
    if source_id is not None:
        clauses.append("source_id = ?")
        values.append(source_id)
    if level:
        clauses.append("level = ?")
        values.append(level)
    if event_type:
        clauses.append("event_type = ?")
        values.append(event_type)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    limit = max(1, min(int(limit or 100), 500))
    with db_connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM system_logs {where} ORDER BY id DESC LIMIT ?",
            [*values, limit],
        ).fetchall()
    return [serialize_log(row) for row in rows]


def create_artifact(
    brand_id: int,
    artifact_type: str,
    title: str,
    payload: dict[str, Any],
    *,
    job_id: int | None = None,
    file_path: str | None = None,
) -> int:
    with db_connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO artifacts
            (brand_id, job_id, artifact_type, title, payload_json, file_path, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (brand_id, job_id, artifact_type, title, to_json(payload), file_path, utc_now()),
        )
        return int(cur.lastrowid)


def update_artifact_payload(artifact_id: int, payload: dict[str, Any]) -> None:
    with db_connect() as conn:
        conn.execute(
            "UPDATE artifacts SET payload_json = ? WHERE id = ?",
            (to_json(payload), artifact_id),
        )


def artifact_file_url(file_path: str | None) -> str | None:
    if not file_path:
        return None
    normalized = str(file_path).replace("\\", "/").strip()
    if not normalized:
        return None
    if normalized.startswith("/artifacts/"):
        return normalized
    filename = normalized.rsplit("/", 1)[-1]
    return f"/artifacts/{filename}" if filename else None


def concept_image_from_artifact(item: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    file_url = payload.get("file_url") or artifact_file_url(item.get("file_path"))
    return {
        "artifact_id": item.get("id"),
        "file_url": file_url,
        "prompt": payload.get("prompt", ""),
        "size": payload.get("size", ""),
        "image_path": payload.get("image_path") or item.get("file_path"),
    }


def enrich_content_payload_with_concept_image(
    brand_id: int,
    content_artifact_id: int,
    payload: dict[str, Any],
    *,
    persist: bool = False,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return payload
    concept = payload.get("concept_image")
    if isinstance(concept, dict) and (concept.get("file_url") or concept.get("image_path")):
        if not concept.get("file_url"):
            concept["file_url"] = artifact_file_url(concept.get("image_path"))
        return payload

    candidate: tuple[dict[str, Any], dict[str, Any]] | None = None
    with db_connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM artifacts
            WHERE brand_id = ? AND artifact_type = ?
            ORDER BY id DESC LIMIT 80
            """,
            (brand_id, "brand_image"),
        ).fetchall()

    for row in rows:
        item = row_to_dict(row) or {}
        image_payload = parse_json_field(item.get("payload_json"), {})
        if not isinstance(image_payload, dict):
            continue
        try:
            linked_id = int(image_payload.get("content_artifact_id") or 0)
        except (TypeError, ValueError):
            linked_id = 0
        if linked_id == content_artifact_id:
            candidate = (item, image_payload)
            break

    if candidate is None:
        for row in reversed(rows):
            item = row_to_dict(row) or {}
            if int(item.get("id") or 0) <= content_artifact_id:
                continue
            image_payload = parse_json_field(item.get("payload_json"), {})
            if isinstance(image_payload, dict):
                candidate = (item, image_payload)
                break

    if candidate:
        item, image_payload = candidate
        payload["concept_image"] = concept_image_from_artifact(item, image_payload)
        if persist:
            update_artifact_payload(content_artifact_id, payload)
    return payload


def text_from_plain_file(path: Path) -> str:
    data = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "cp950", "big5", "latin-1"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = data.decode("utf-8", errors="replace")
    if path.suffix.lower() == ".json":
        try:
            return json.dumps(json.loads(text), ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            return text
    if path.suffix.lower() in {".html", ".htm"}:
        try:
            from bs4 import BeautifulSoup

            return BeautifulSoup(text, "html.parser").get_text("\n", strip=True)
        except ImportError:
            return text
    return text


def extract_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("PDF 閫???閬?pypdf嚗??銵?pip install -r requirements.txt") from exc
    reader = PdfReader(str(path))
    return "\n\n".join(page.extract_text() or "" for page in reader.pages).strip()


def extract_docx(path: Path) -> str:
    try:
        import docx
    except ImportError as exc:
        raise RuntimeError("Word 閫???閬?python-docx嚗??銵?pip install -r requirements.txt") from exc
    doc = docx.Document(str(path))
    parts = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            parts.append(" | ".join(cell.text.strip() for cell in row.cells))
    return "\n".join(parts).strip()


def extract_spreadsheet(path: Path) -> str:
    try:
        import pandas as pd
    except ImportError as exc:
        raise RuntimeError("Excel 閫???閬?pandas/openpyxl嚗??銵?pip install -r requirements.txt") from exc
    sheets = pd.read_excel(path, sheet_name=None)
    blocks = []
    for name, frame in sheets.items():
        blocks.append(f"## Sheet: {name}\n{frame.to_csv(index=False)}")
    return "\n\n".join(blocks).strip()


def extract_pptx(path: Path) -> str:
    try:
        from pptx import Presentation
    except ImportError as exc:
        raise RuntimeError("PowerPoint 閫???閬?python-pptx嚗??銵?pip install -r requirements.txt") from exc
    prs = Presentation(str(path))
    blocks = []
    for idx, slide in enumerate(prs.slides, start=1):
        texts = []
        for shape in slide.shapes:
            if hasattr(shape, "text") and shape.text.strip():
                texts.append(shape.text.strip())
        if texts:
            blocks.append(f"## Slide {idx}\n" + "\n".join(texts))
    return "\n\n".join(blocks).strip()


def extract_image_with_openai(path: Path, mime_type: str | None) -> str:
    image_url = image_data_url_for_openai(path, mime_type)
    return generate_openai_text(
        [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": "Extract and summarize all readable text and important visual details from this image for BrandDNA analysis. Return plain Traditional Chinese text.",
                    },
                    {"type": "input_image", "image_url": image_url, "detail": openai_image_detail_for("ocr")},
                ],
            }
        ],
        system_instruction="You extract OCR text and visual context for a Taiwanese restaurant brand analytics pipeline. Return concise plain text only.",
        task="ocr",
    )


def image_data_url_for_openai(path: Path, mime_type: str | None = None) -> str:
    mime = (mime_type or mimetypes.guess_type(path.name)[0] or "image/png").split(";")[0].strip().lower()
    supported_mimes = {"image/png", "image/jpeg", "image/webp", "image/gif"}
    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("圖片格式需轉換為 PNG 才能交給 OpenAI 分析，請先安裝 requirements.txt。") from exc

    try:
        with Image.open(path) as image:
            image.verify()
    except Exception as exc:
        raise RuntimeError("圖片檔案無法讀取，請重新上傳有效的 PNG/JPG/WEBP/GIF 圖片。") from exc

    if mime in supported_mimes:
        image_bytes = path.read_bytes()
        return f"data:{mime};base64,{base64.b64encode(image_bytes).decode('utf-8')}"

    with Image.open(path) as image:
        if image.mode not in {"RGB", "RGBA"}:
            image = image.convert("RGB")
        buffer = BytesIO()
        image.save(buffer, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode('utf-8')}"


def source_image_records(source: dict[str, Any], extraction: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    source_metadata = parse_json_field(source.get("metadata_json"), {})
    extraction_metadata = parse_json_field((extraction or {}).get("metadata_json"), {})

    if source.get("input_kind") == "image" and source.get("raw_path"):
        records.append(
            {
                "path": source.get("raw_path"),
                "mime_type": source.get("mime_type"),
                "label": source.get("original_filename") or source.get("title") or "uploaded image",
            }
        )

    for post in source_metadata.get("manual_social_posts") or []:
        records.append(
            {
                "path": post.get("image_path"),
                "mime_type": post.get("mime_type"),
                "label": f"Post {post.get('index') or ''} image".strip(),
            }
        )

    for image in extraction_metadata.get("downloaded_images") or []:
        records.append(
            {
                "path": image.get("path"),
                "mime_type": image.get("mime_type"),
                "label": image.get("alt") or image.get("source_url") or "downloaded image",
            }
        )

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for record in records:
        stored_path = str(record.get("path") or "").strip()
        if not stored_path or stored_path in seen:
            continue
        path = absolute_stored_path(stored_path)
        if not path or not path.exists() or not path.is_file():
            continue
        seen.add(stored_path)
        deduped.append({**record, "absolute_path": path})
        if len(deduped) >= MAX_ANALYSIS_IMAGE_INPUTS:
            break
    return deduped


def source_analysis_input(prompt: str, source: dict[str, Any], extraction: dict[str, Any]) -> Any:
    image_records = source_image_records(source, extraction)
    if not image_records:
        return prompt

    content: list[dict[str, Any]] = [{"type": "input_text", "text": prompt}]
    for record in image_records:
        path = record["absolute_path"]
        content.append({"type": "input_text", "text": f"Image context: {record.get('label') or path.name}"})
        content.append(
            {
                "type": "input_image",
                "image_url": image_data_url_for_openai(path, record.get("mime_type")),
                "detail": openai_image_detail_for("source_analysis"),
            }
        )
    return [{"role": "user", "content": content}]


def clean_legacy_source_text(text: str, source: dict[str, Any]) -> str:
    if not text:
        return ""
    cleaned = text
    source_type = source.get("source_type", "")
    label = source_type_label(source_type)
    metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else parse_json_field(source.get("metadata_json"), {})
    if metadata.get("manual_social_posts"):
        count = metadata.get("manual_post_count") or len(metadata.get("manual_social_posts") or [])
        lines = cleaned.splitlines()
        if lines and has_mojibake_text(lines[0]):
            lines[0] = f"{label} 手動輸入貼文，共 {count} 篇"
            cleaned = "\n".join(lines)
    replacements = {
        "Image filename:": "圖片檔名：",
        "Image path:": "圖片路徑：",
    }
    for old, new in replacements.items():
        cleaned = cleaned.replace(old, new)
    return cleaned


def clean_legacy_source_title(source: dict[str, Any]) -> str:
    title = str(source.get("title") or "").strip()
    if title and not has_mojibake_text(title):
        return title
    metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else parse_json_field(source.get("metadata_json"), {})
    label = source_type_label(source.get("source_type", ""))
    mode = metadata.get("source_input_mode")
    if metadata.get("manual_fallback"):
        return f"{label} 手動補資料"
    if source.get("source_type") in SOCIAL_POST_SOURCE_TYPES and source.get("input_kind") == "text":
        return f"{label} 手動貼文"
    if mode == "manual" or source.get("input_kind") == "text":
        return f"{label} 手動輸入"
    if mode == "url" or source.get("input_kind") == "url":
        return f"{label} URL 擷取"
    return label or title


def has_mojibake_text(value: str) -> bool:
    return bool(re.search(r"[\uFFFD\uF000-\uF8FF]|鞈|頛|蝭|蝑|摰|靘|皞|隢|嚗|銝|瘝|撠|\?{2,}", str(value or "")))

def crawl_candidate_urls(base_url: str, html: str, limit: int) -> list[str]:
    if limit <= 1:
        return []
    parsed_base = urlparse(base_url)
    candidates: list[str] = []
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        hrefs = [a.get("href") for a in soup.find_all("a")]
    except ImportError:
        hrefs = []

    blocked_suffixes = DOCUMENT_EXTENSIONS | IMAGE_EXTENSIONS | {".zip", ".rar", ".7z", ".mp4", ".mov"}
    for href in hrefs:
        absolute = urljoin(base_url, str(href or "").strip())
        parsed = urlparse(absolute)
        if parsed.scheme not in {"http", "https"} or parsed.netloc != parsed_base.netloc:
            continue
        path_lower = parsed.path.lower()
        if any(path_lower.endswith(suffix) for suffix in blocked_suffixes):
            continue
        normalized = parsed._replace(fragment="").geturl()
        if normalized != base_url and normalized not in candidates:
            candidates.append(normalized)
        if len(candidates) >= limit - 1:
            break
    return candidates


def canonical_netloc(url: str) -> str:
    parsed = urlparse(url)
    return parsed.netloc.lower().removeprefix("www.")


def clean_url_query(query: str) -> str:
    tracking_keys = {"fbclid", "gclid", "yclid", "mc_cid", "mc_eid", "igshid"}
    kept = []
    for key, value in parse_qsl(query, keep_blank_values=False):
        key_lower = key.lower()
        if key_lower.startswith("utm_") or key_lower in tracking_keys:
            continue
        kept.append((key, value))
    if len(kept) > 3:
        return ""
    return urlencode(kept, doseq=True)


def normalize_internal_website_url(site_url: str, href: str, *, current_url: str | None = None) -> str | None:
    base_url = current_url or site_url
    absolute = urljoin(base_url, str(href or "").strip())
    parsed = urlparse(absolute)
    if parsed.scheme not in {"http", "https"}:
        return None
    if canonical_netloc(absolute) != canonical_netloc(site_url):
        return None
    path_lower = parsed.path.lower()
    blocked_suffixes = DOCUMENT_EXTENSIONS | IMAGE_EXTENSIONS | {".zip", ".rar", ".7z", ".mp4", ".mov", ".webm"}
    if any(path_lower.endswith(suffix) for suffix in blocked_suffixes):
        return None
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = clean_url_query(parsed.query)
    return parsed._replace(path=path, params="", query=query, fragment="").geturl()


def website_link_score(url: str, link_text: str = "", context_text: str = "") -> int:
    parsed = urlparse(url)
    haystack = f"{parsed.path} {parsed.query} {link_text} {context_text}".lower()
    score = 1
    for keyword, weight in WEBSITE_VALUE_KEYWORDS.items():
        if keyword.lower() in haystack:
            score += weight
    for keyword in WEBSITE_LOW_VALUE_KEYWORDS:
        if keyword.lower() in haystack:
            score -= 35
    path_parts = [part for part in parsed.path.split("/") if part]
    if len(path_parts) <= 2:
        score += 4
    if any(token in context_text.lower() for token in ("nav", "menu", "header", "footer", "撠汗")):
        score += 8
    if parsed.query:
        score -= 6
    return score


def classify_website_page(url: str, title: str = "", text: str = "") -> str:
    haystack = f"{url} {title} {text[:1000]}".lower()
    buckets = [
        ("menu", ("menu", "菜單", "餐點", "產品", "品項")),
        ("about", ("about", "關於", "品牌", "story", "故事", "理念")),
        ("contact", ("contact", "聯絡", "location", "store", "地址", "門市", "交通")),
        ("news", ("news", "blog", "消息", "公告", "活動")),
        ("faq", ("faq", "常見問題")),
        ("order", ("reservation", "訂位", "order", "預訂")),
    ]
    for role, keywords in buckets:
        if any(keyword in haystack for keyword in keywords):
            return role
    return "landing" if urlparse(url).path in {"", "/"} else "page"


def extract_website_candidate_links(site_url: str, current_url: str, html: str, depth: int, limit: int = 80) -> list[dict[str, Any]]:
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
    except ImportError:
        return []

    candidates: dict[str, dict[str, Any]] = {}
    for anchor in soup.find_all("a"):
        normalized = normalize_internal_website_url(site_url, anchor.get("href"), current_url=current_url)
        if not normalized:
            continue
        link_text = anchor.get_text(" ", strip=True)
        context_parts = []
        for parent in list(anchor.parents)[:4]:
            classes = " ".join(parent.get("class", [])) if hasattr(parent, "get") else ""
            context_parts.append(f"{getattr(parent, 'name', '')} {parent.get('id', '') if hasattr(parent, 'get') else ''} {classes}")
        context_text = " ".join(context_parts)
        score = website_link_score(normalized, link_text, context_text)
        if score <= -10:
            continue
        existing = candidates.get(normalized)
        item = {
            "url": normalized,
            "depth": depth,
            "score": score,
            "reason": "page_link",
            "link_text": link_text[:120],
        }
        if not existing or item["score"] > existing["score"]:
            candidates[normalized] = item
    return sorted(candidates.values(), key=lambda item: (-item["score"], item["depth"], item["url"]))[:limit]


def sitemap_locations_from_robots(request_context, site_url: str) -> list[str]:
    parsed = urlparse(site_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    sitemap_urls: list[str] = []
    try:
        response = request_context.get(f"{origin}/robots.txt", timeout=10000)
        if response.ok:
            for line in response.text().splitlines():
                if line.lower().startswith("sitemap:"):
                    sitemap_url = line.split(":", 1)[1].strip()
                    if sitemap_url and sitemap_url not in sitemap_urls:
                        sitemap_urls.append(sitemap_url)
    except Exception:
        pass
    for path in ("/sitemap.xml", "/sitemap_index.xml"):
        candidate = f"{origin}{path}"
        if candidate not in sitemap_urls:
            sitemap_urls.append(candidate)
    return sitemap_urls


def discover_sitemap_candidate_urls(request_context, site_url: str, limit: int = 80) -> list[dict[str, Any]]:
    candidates: dict[str, dict[str, Any]] = {}
    sitemap_queue = [{"url": url, "depth": 0} for url in sitemap_locations_from_robots(request_context, site_url)]
    seen_sitemaps: set[str] = set()

    while sitemap_queue and len(candidates) < limit:
        item = sitemap_queue.pop(0)
        sitemap_url = item["url"]
        if sitemap_url in seen_sitemaps or item["depth"] > 2:
            continue
        seen_sitemaps.add(sitemap_url)
        try:
            response = request_context.get(sitemap_url, timeout=15000)
            if not response.ok:
                continue
            root = ET.fromstring(response.text().encode("utf-8"))
        except Exception:
            continue
        locs = [element.text.strip() for element in root.iter() if element.tag.endswith("loc") and element.text]
        for loc in locs:
            if loc.lower().endswith(".xml") and item["depth"] < 2:
                sitemap_queue.append({"url": loc, "depth": item["depth"] + 1})
                continue
            normalized = normalize_internal_website_url(site_url, loc)
            if not normalized:
                continue
            score = website_link_score(normalized) + 12
            if normalized not in candidates or score > candidates[normalized]["score"]:
                candidates[normalized] = {
                    "url": normalized,
                    "depth": 1,
                    "score": score,
                    "reason": "sitemap",
                    "link_text": "",
                }

    return sorted(candidates.values(), key=lambda candidate: (-candidate["score"], candidate["url"]))[:limit]


def website_meta_payload(page) -> dict[str, Any]:
    return page.evaluate(
        """
        () => ({
            title: document.title || "",
            description: document.querySelector('meta[name="description"]')?.content || "",
            ogTitle: document.querySelector('meta[property="og:title"]')?.content || "",
            ogDescription: document.querySelector('meta[property="og:description"]')?.content || "",
            h1: Array.from(document.querySelectorAll('h1')).map(node => node.textContent.trim()).filter(Boolean).slice(0, 5)
        })
        """
    )


def explore_website_with_playwright(
    page,
    source: dict[str, Any],
    start_url: str,
    shot_path: Path,
    html_path: Path,
    *,
    crawl_limit: int,
    max_depth: int,
    max_seconds: int,
) -> tuple[str, str | None, dict[str, Any]]:
    pending: list[dict[str, Any]] = [
        {"url": normalize_internal_website_url(start_url, start_url) or start_url, "depth": 0, "score": 10_000, "reason": "homepage", "link_text": ""}
    ]
    queued_keys = {pending[0]["url"]}
    visited_keys: set[str] = set()
    visited_pages: list[dict[str, Any]] = []
    skipped_pages: list[dict[str, Any]] = []
    downloaded_images: list[dict[str, Any]] = []
    html_blocks: list[str] = []
    text_blocks: list[str] = []
    started_at = time.perf_counter()
    captured_screenshot = False
    order = 0

    def enqueue(candidate: dict[str, Any]) -> None:
        nonlocal order
        url = candidate.get("url")
        if not url or url in queued_keys or url in visited_keys:
            return
        if candidate.get("depth", 0) > max_depth:
            return
        order += 1
        queued_keys.add(url)
        pending.append({**candidate, "order": order})

    for candidate in discover_sitemap_candidate_urls(page.context.request, start_url, crawl_limit * 4):
        enqueue(candidate)

    while pending and len([item for item in visited_pages if item.get("status") == "captured"]) < crawl_limit:
        if (time.perf_counter() - started_at) > max_seconds:
            skipped_pages.append({"status": "skipped", "reason": "time_budget_exceeded", "remaining_queue": len(pending)})
            break
        pending.sort(key=lambda item: (-int(item.get("score") or 0), int(item.get("depth") or 0), int(item.get("order") or 0)))
        candidate = pending.pop(0)
        current_url = candidate["url"]
        if current_url in visited_keys:
            continue
        visited_keys.add(current_url)
        try:
            page.goto(current_url, wait_until="networkidle", timeout=35000)
            final_url = normalize_internal_website_url(start_url, page.url) or current_url
            html = page.content()
            text = page.locator("body").inner_text(timeout=10000).strip()
            meta = website_meta_payload(page)
            page_role = classify_website_page(final_url, meta.get("title", ""), text)
            if not captured_screenshot:
                page.screenshot(path=str(shot_path), full_page=True)
                captured_screenshot = True
            page_images = download_page_images(
                page,
                source,
                final_url,
                page_role=page_role,
                page_index=len(visited_pages) + 1,
                limit=WEBSITE_MAX_IMAGES_PER_PAGE,
            )
            downloaded_images.extend([item for item in page_images if item.get("path")])
            visited_pages.append(
                {
                    "url": final_url,
                    "status": "captured",
                    "role": page_role,
                    "depth": candidate.get("depth", 0),
                    "score": candidate.get("score", 0),
                    "reason": candidate.get("reason"),
                    "title": meta.get("title") or meta.get("ogTitle") or "",
                    "description": meta.get("description") or meta.get("ogDescription") or "",
                    "char_count": len(text),
                    "image_count": len([item for item in page_images if item.get("path")]),
                }
            )
            html_blocks.append(f"<!-- Source URL: {final_url} -->\n{html}")
            if text:
                text_blocks.append(f"## {final_url}\nPage role: {page_role}\nTitle: {meta.get('title') or ''}\n{text}")
            if int(candidate.get("depth") or 0) < max_depth:
                for next_candidate in extract_website_candidate_links(
                    start_url,
                    final_url,
                    html,
                    int(candidate.get("depth") or 0) + 1,
                    limit=80,
                ):
                    enqueue(next_candidate)
        except Exception as exc:
            visited_pages.append(
                {
                    "url": current_url,
                    "status": "error",
                    "depth": candidate.get("depth", 0),
                    "score": candidate.get("score", 0),
                    "reason": candidate.get("reason"),
                    "error": str(exc),
                }
            )

    html_path.write_text("\n\n".join(html_blocks), encoding="utf-8")
    captured = [item for item in visited_pages if item.get("status") == "captured"]
    role_counts: dict[str, int] = {}
    for item in captured:
        role = str(item.get("role") or "page")
        role_counts[role] = role_counts.get(role, 0) + 1
    summary = (
        "Website crawl summary\n"
        "- Strategy: agentic site explorer with sitemap, navigation scoring, and page capture\n"
        f"- Start URL: {start_url}\n"
        f"- Captured pages: {len(captured)} / {crawl_limit}\n"
        f"- Max depth: {max_depth}\n"
        f"- Page roles: {to_json(role_counts)}\n"
        f"- Downloaded images: {len(downloaded_images)}\n"
    )
    text = f"{summary}\n\n" + "\n\n".join(text_blocks).strip()
    return (
        text.strip(),
        safe_relative_path(shot_path) if captured_screenshot else None,
        {
            "url": start_url,
            "html_path": safe_relative_path(html_path),
            "crawl_limit": crawl_limit,
            "max_depth": max_depth,
            "max_seconds": max_seconds,
            "exploration": "agentic_site_explorer",
            "visited_pages": visited_pages,
            "skipped_pages": skipped_pages,
            "coverage_summary": {"captured_count": len(captured), "role_counts": role_counts},
            "downloaded_images": downloaded_images,
            "downloaded_image_count": len(downloaded_images),
        },
    )


def is_social_post_url(url: str, source_type: str) -> bool:
    parsed = urlparse(url)
    path = parsed.path.lower()
    query = parsed.query.lower()
    if source_type == "instagram":
        return any(marker in path for marker in ("/p/", "/reel/", "/tv/"))
    if source_type == "facebook":
        return (
            "/posts/" in path
            or "/videos/" in path
            or "/reel/" in path
            or path.endswith("/permalink.php")
            or path.endswith("/story.php")
            or path.endswith("/photo.php")
            or "story_fbid=" in query
            or "fbid=" in query
        )
    return False


def social_post_candidate_urls(base_url: str, html: str, source_type: str, limit: int) -> list[str]:
    parsed_base = urlparse(base_url)
    candidates: list[str] = []
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        hrefs = [a.get("href") for a in soup.find_all("a")]
    except ImportError:
        hrefs = []

    for href in hrefs:
        absolute = urljoin(base_url, str(href or "").strip())
        parsed = urlparse(absolute)
        if parsed.scheme not in {"http", "https"}:
            continue
        if source_type == "instagram" and "instagram.com" not in parsed.netloc:
            continue
        if source_type == "facebook" and not any(host in parsed.netloc for host in ("facebook.com", "fb.watch")):
            continue
        if not is_social_post_url(absolute, source_type):
            continue
        normalized = parsed._replace(fragment="").geturl()
        if normalized != base_url and normalized not in candidates:
            candidates.append(normalized)
        if len(candidates) >= limit:
            break

    if parsed_base.scheme in {"http", "https"}:
        return candidates
    return []


def extension_for_image(content_type: str | None, image_url: str | None = None) -> str:
    mime = (content_type or "").split(";")[0].strip().lower()
    guessed = mimetypes.guess_extension(mime) if mime else None
    if guessed in IMAGE_EXTENSIONS:
        return guessed
    path_suffix = Path(urlparse(image_url or "").path).suffix.lower()
    if path_suffix in IMAGE_EXTENSIONS:
        return path_suffix
    return ".jpg"


def rendered_image_candidates(page, *, min_size: int = 160, limit: int = 12) -> list[dict[str, Any]]:
    images = page.evaluate(
        """
        () => Array.from(document.images).map((img, index) => {
            const rect = img.getBoundingClientRect();
            return {
                index,
                src: img.currentSrc || img.src || "",
                alt: img.alt || "",
                width: img.naturalWidth || Math.round(rect.width) || 0,
                height: img.naturalHeight || Math.round(rect.height) || 0,
                renderedWidth: Math.round(rect.width) || 0,
                renderedHeight: Math.round(rect.height) || 0
            };
        })
        """
    )
    filtered = []
    seen: set[str] = set()
    for item in images or []:
        src = str(item.get("src") or "").strip()
        parsed = urlparse(src)
        if parsed.scheme not in {"http", "https"} or src in seen:
            continue
        width = int(item.get("width") or item.get("renderedWidth") or 0)
        height = int(item.get("height") or item.get("renderedHeight") or 0)
        if width and height and max(width, height) < min_size:
            continue
        if any(token in parsed.path.lower() for token in (".svg", "emoji", "sprite", "favicon")):
            continue
        seen.add(src)
        filtered.append({**item, "src": src, "area": width * height})
    filtered.sort(key=lambda item: int(item.get("area") or 0), reverse=True)
    return filtered[:limit]


def download_page_images(
    page,
    source: dict[str, Any],
    page_url: str,
    *,
    page_role: str,
    page_index: int,
    limit: int = MAX_SOCIAL_IMAGES_PER_POST,
) -> list[dict[str, Any]]:
    image_records: list[dict[str, Any]] = []
    folder = RAWDATA_FOLDER / "url_images" / f"source_{source['id']}"
    for image_index, item in enumerate(rendered_image_candidates(page, limit=limit * 3), start=1):
        if len([record for record in image_records if record.get("path")]) >= limit:
            break
        src = item["src"]
        try:
            response = page.context.request.get(src, timeout=15000)
            if not response.ok:
                continue
            body = response.body()
            if len(body) < 2048:
                continue
            content_type = response.headers.get("content-type", "")
            if "image" not in content_type.lower():
                continue
            suffix = extension_for_image(content_type, src)
            filename = f"{page_role}_{page_index}_{image_index}{suffix}"
            path = unique_file_path(folder, filename)
            path.write_bytes(body)
            image_records.append(
                {
                    "page_url": page_url,
                    "page_role": page_role,
                    "source_url": src,
                    "path": safe_relative_path(path),
                    "mime_type": content_type.split(";")[0].strip() or None,
                    "alt": item.get("alt") or "",
                    "width": item.get("width") or item.get("renderedWidth"),
                    "height": item.get("height") or item.get("renderedHeight"),
                }
            )
        except Exception as exc:
            image_records.append(
                {
                    "page_url": page_url,
                    "page_role": page_role,
                    "source_url": src,
                    "status": "error",
                    "error": str(exc),
                }
            )
    return image_records


def extract_url_with_playwright(source: dict[str, Any]) -> tuple[str, str | None, dict[str, Any]]:
    url = source.get("url")
    if not url:
        raise RuntimeError("URL source 蝻箏? url 甈?")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("URL 擷取需要 Playwright，請先安裝 requirements.txt。") from exc

    source_type = source.get("source_type", "")
    source_config = URL_SOURCE_CONFIG.get(source_type, {})
    crawl_limit = int(source_config.get("crawl_limit", 1))
    is_social_post_source = source_type in SOCIAL_POST_SOURCE_TYPES
    post_limit = int(source_config.get("post_limit", crawl_limit if is_social_post_source else 0))
    shot_path = ARTIFACT_FOLDER / f"url_capture_{source['id']}_{uuid.uuid4().hex[:8]}.png"
    html_path = RAWDATA_FOLDER / f"url_html_{source['id']}_{uuid.uuid4().hex[:8]}.html"
    visited_pages: list[dict[str, Any]] = []
    downloaded_images: list[dict[str, Any]] = []
    html_blocks: list[str] = []
    text_blocks: list[str] = []
    started_at = time.perf_counter()
    log_event(
        "info",
        "crawler.started",
        f"Started crawler for source #{source['id']}.",
        brand_id=source.get("brand_id"),
        source_id=source.get("id"),
        stage=source_type or "url",
        details={"url": url, "source_type": source_type, "crawl_limit": crawl_limit, "post_limit": post_limit},
    )

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(headless=True)
        except Exception as exc:
            raise RuntimeError("Playwright Chromium 尚未安裝，請執行 python -m playwright install chromium。") from exc
        try:
            page = browser.new_page(
                viewport={"width": 1366, "height": 1800},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
                ),
            )
            if source_type == "website":
                text, artifact_path, metadata = explore_website_with_playwright(
                    page,
                    source,
                    url,
                    shot_path,
                    html_path,
                    crawl_limit=crawl_limit,
                    max_depth=int(source_config.get("max_depth", WEBSITE_MAX_DEPTH)),
                    max_seconds=int(source_config.get("max_seconds", WEBSITE_MAX_SECONDS)),
                )
                if len(text) < 80:
                    raise RuntimeError("公開頁可讀文字不足，請改用手動補資料。")
                duration_ms = int((time.perf_counter() - started_at) * 1000)
                log_event(
                    "info",
                    "crawler.completed",
                    f"Completed website explorer for source #{source['id']}.",
                    brand_id=source.get("brand_id"),
                    source_id=source.get("id"),
                    stage=source_type,
                    details={
                        "url": url,
                        "source_type": source_type,
                        "char_count": len(text),
                        "screenshot_path": artifact_path,
                        **metadata,
                    },
                    duration_ms=duration_ms,
                )
                return text, artifact_path, metadata
            pending = [url]
            captured_screenshot = False
            social_posts_seen = 0
            profile_seen = False
            while pending:
                if is_social_post_source:
                    if profile_seen and social_posts_seen >= post_limit:
                        break
                elif len(visited_pages) >= crawl_limit:
                    break
                current_url = pending.pop(0)
                if any(item["url"] == current_url for item in visited_pages):
                    continue
                try:
                    page.goto(current_url, wait_until="networkidle", timeout=35000)
                    html = page.content()
                    text = page.locator("body").inner_text(timeout=10000).strip()
                    page_is_social_post = is_social_post_source and is_social_post_url(current_url, source_type)
                    page_role = "post" if page_is_social_post else "profile" if is_social_post_source else "page"
                    if not captured_screenshot:
                        page.screenshot(path=str(shot_path), full_page=True)
                        captured_screenshot = True
                    page_images: list[dict[str, Any]] = []
                    if page_is_social_post or not is_social_post_source:
                        page_images = download_page_images(
                            page,
                            source,
                            current_url,
                            page_role=page_role,
                            page_index=len(visited_pages) + 1,
                            limit=MAX_SOCIAL_IMAGES_PER_POST if page_is_social_post else 1,
                        )
                        downloaded_images.extend([item for item in page_images if item.get("path")])
                    visited_pages.append(
                        {
                            "url": current_url,
                            "status": "captured",
                            "role": page_role,
                            "char_count": len(text),
                            "image_count": len([item for item in page_images if item.get("path")]),
                        }
                    )
                    html_blocks.append(f"<!-- Source URL: {current_url} -->\n{html}")
                    if text:
                        text_blocks.append(f"## {current_url}\n{text}")
                    if page_is_social_post:
                        social_posts_seen += 1
                    elif is_social_post_source:
                        profile_seen = True
                    if is_social_post_source and not page_is_social_post and social_posts_seen < post_limit:
                        candidates = social_post_candidate_urls(current_url, html, source_type, post_limit)
                        if not candidates:
                            candidates = [
                                candidate
                                for candidate in crawl_candidate_urls(current_url, html, post_limit + 1)
                                if is_social_post_url(candidate, source_type)
                            ]
                        pending.extend(candidate for candidate in candidates if candidate not in pending)
                    elif not is_social_post_source and len(visited_pages) == 1 and crawl_limit > 1:
                        pending.extend(crawl_candidate_urls(current_url, html, crawl_limit))
                except Exception as exc:
                    visited_pages.append({"url": current_url, "status": "error", "error": str(exc)})
        finally:
            browser.close()

    html_path.write_text("\n\n".join(html_blocks), encoding="utf-8")
    text = "\n\n".join(text_blocks).strip()
    if len(text) < 80:
        raise RuntimeError("公開頁可讀文字不足，請改用手動補資料。")
    duration_ms = int((time.perf_counter() - started_at) * 1000)
    log_event(
        "info",
        "crawler.completed",
        f"Completed crawler for source #{source['id']}.",
        brand_id=source.get("brand_id"),
        source_id=source.get("id"),
        stage=source_type or "url",
        details={
            "url": url,
            "source_type": source_type,
            "crawl_limit": crawl_limit,
            "post_limit": post_limit,
            "visited_pages": visited_pages,
            "downloaded_images": downloaded_images,
            "downloaded_image_count": len(downloaded_images),
            "char_count": len(text),
            "html_path": safe_relative_path(html_path),
            "screenshot_path": safe_relative_path(shot_path),
        },
        duration_ms=duration_ms,
    )
    return (
        text,
        safe_relative_path(shot_path),
        {
            "url": url,
            "html_path": safe_relative_path(html_path),
            "crawl_limit": crawl_limit,
            "post_limit": post_limit,
            "visited_pages": visited_pages,
            "downloaded_images": downloaded_images,
            "downloaded_image_count": len(downloaded_images),
        },
    )


def split_social_preview_posts(text: str, source_type: str, limit: int = SOCIAL_POST_COUNT) -> list[dict[str, Any]]:
    posts: list[dict[str, Any]] = []
    fallback_blocks: list[str] = []
    blocks = re.split(r"\n(?=##\s+)", text.strip())
    for block in blocks:
        cleaned = block.strip()
        if not cleaned:
            continue
        header_match = re.match(r"^##\s+(.+?)\s*\n(.*)$", cleaned, flags=re.S)
        if header_match:
            source_url = header_match.group(1).strip()
            content = header_match.group(2).strip()
        else:
            source_url = ""
            content = cleaned
        content = re.sub(r"\n{3,}", "\n\n", content)
        content = "\n".join(line.strip() for line in content.splitlines() if line.strip())
        if not content:
            continue
        item = {"index": len(posts) + 1, "content": content[:1800], "source_url": source_url}
        if source_url and is_social_post_url(source_url, source_type):
            posts.append(item)
        else:
            fallback_blocks.append(content)
        if len(posts) >= limit:
            return posts[:limit]

    if len(posts) < limit:
        paragraphs: list[str] = []
        for block in fallback_blocks or [text]:
            paragraphs.extend(part.strip() for part in re.split(r"\n\s*\n", block) if part.strip())
        for paragraph in paragraphs:
            compact = "\n".join(line.strip() for line in paragraph.splitlines() if line.strip())
            if len(compact) < 20 or any(existing["content"] == compact[:1800] for existing in posts):
                continue
            posts.append({"index": len(posts) + 1, "content": compact[:1800], "source_url": ""})
            if len(posts) >= limit:
                break
    return posts[:limit]


def extract_source_content(source_id: int) -> dict[str, Any]:
    source = fetch_source(source_id)
    if not source:
        raise RuntimeError("?曆??圈?鞈?靘?")

    input_kind = source["input_kind"]
    raw_path = absolute_stored_path(source.get("raw_path"))
    metadata: dict[str, Any] = {}
    artifact_path = None
    started_at = time.perf_counter()
    log_event(
        "info",
        "extract.started",
        f"Started extraction for source #{source_id}.",
        brand_id=source["brand_id"],
        source_id=source_id,
        stage="extract",
        details={"source_type": source.get("source_type"), "input_kind": input_kind, "url": source.get("url")},
    )

    try:
        if input_kind == "url":
            text, artifact_path, metadata = extract_url_with_playwright(source)
        elif input_kind == "image":
            if raw_path is None:
                raise RuntimeError("?? source 蝻箏? raw_path")
            text = extract_image_with_openai(raw_path, source.get("mime_type"))
        elif input_kind in {"text", "file"}:
            if raw_path is None:
                raise RuntimeError("source 蝻箏? raw_path")
            suffix = raw_path.suffix.lower()
            if suffix in TEXT_EXTENSIONS:
                text = text_from_plain_file(raw_path)
            elif suffix == ".pdf":
                text = extract_pdf(raw_path)
            elif suffix == ".docx":
                text = extract_docx(raw_path)
            elif suffix in {".xlsx", ".xls"}:
                text = extract_spreadsheet(raw_path)
            elif suffix == ".pptx":
                text = extract_pptx(raw_path)
            else:
                message = f"Unsupported raw file type: {suffix or 'unknown'}. Please provide text manually."
                return create_extraction_result(source, "needs_manual_text", error=message)
        else:
            raise RuntimeError(f"銝?渡? input_kind: {input_kind}")

        text = (text or "").strip()
        if not text:
            raise RuntimeError("?瑕?敺???敺?摮摰對?隢?冽?摮票銝??? OCR??")
        return create_extraction_result(
            source,
            "extracted",
            text,
            artifact_path=artifact_path,
            metadata={**metadata, "char_count": len(text)},
        )
    except Exception as exc:
        log_event(
            "error",
            "extract.exception",
            f"Extraction raised for source #{source_id}.",
            brand_id=source["brand_id"],
            source_id=source_id,
            stage="extract",
            details={"duration_ms": int((time.perf_counter() - started_at) * 1000)},
            error=str(exc),
        )
        return create_extraction_result(source, "error", error=str(exc))


def analyze_source_content(source_id: int) -> dict[str, Any]:
    source = fetch_source(source_id)
    if not source:
        raise RuntimeError("?曆??圈?鞈?靘?")
    log_event(
        "info",
        "analyze.started",
        f"Started analysis for source #{source_id}.",
        brand_id=source["brand_id"],
        source_id=source_id,
        stage="analyze",
        details={"source_type": source.get("source_type")},
    )
    extraction = latest_extraction(source_id)
    if not extraction or extraction["status"] != "extracted":
        extraction = extract_source_content(source_id)
    if extraction["status"] != "extracted" or not extraction.get("extracted_text"):
        return create_analysis_result(source, "error", error=extraction.get("error") or "鞈?撠???渡??????")

    source_label = source.get("title") or source.get("source_type")
    prompt = f"""
Analyze this BrandDNA source for a Taiwanese restaurant brand.
Source title: {source_label}
Source type: {source.get('source_type')}
Extracted text:
{extraction['extracted_text'][:18000]}

If image inputs are attached to this request, inspect them as first-class source evidence.
Use visible menu items, product photos, typography, colors, layout, disclaimers, and any readable text
from the images together with the extracted text. Do not say images were analyzed unless an image is attached.

Return valid JSON:
{{
  "source_summary": "...",
  "archetype_signals": {{
    "primary": "everyman",
    "secondary": ["caregiver"],
    "scores": {{
      "innocent": {{"score": 0, "reasoning": "..."}},
      "explorer": {{"score": 0, "reasoning": "..."}},
      "sage": {{"score": 0, "reasoning": "..."}},
      "hero": {{"score": 0, "reasoning": "..."}},
      "outlaw": {{"score": 0, "reasoning": "..."}},
      "magician": {{"score": 0, "reasoning": "..."}},
      "everyman": {{"score": 0, "reasoning": "..."}},
      "lover": {{"score": 0, "reasoning": "..."}},
      "jester": {{"score": 0, "reasoning": "..."}},
      "caregiver": {{"score": 0, "reasoning": "..."}},
      "creator": {{"score": 0, "reasoning": "..."}},
      "ruler": {{"score": 0, "reasoning": "..."}}
    }}
  }},
  "brand_role_evidence": {{
    "positioning": ["..."],
    "traits": ["..."],
    "voice": ["..."],
    "visual_personality": ["..."],
    "target_audience": ["..."]
  }},
  "keywords": ["..."],
  "tone_markers": ["..."],
  "visual_evidence": ["..."],
  "risks_or_gaps": ["..."],
  "content_opportunities": ["..."]
}}
"""
    started_at = time.perf_counter()
    log_event(
        "info",
        "ai.requested",
        f"Requested AI analysis for source #{source_id}.",
        brand_id=source["brand_id"],
        source_id=source_id,
        stage="source_analysis",
        details={
            "model": openai_model_for("source_analysis"),
            "input_chars": len(extraction.get("extracted_text") or ""),
            "image_inputs": len(source_image_records(source, extraction)),
        },
    )
    try:
        result = generate_openai_json(
            source_analysis_input(prompt, source, extraction),
            system_instruction=(
                "You are a BrandDNA source analyst for Taiwanese restaurant and retail brands. "
                "Extract only evidence-backed signals from this single source, including both text and attached images when present. "
                "When images are attached, include concrete observations in visual_evidence. "
                "Return Traditional Chinese for user-facing text."
            ),
            temperature=0.15,
            task="source_analysis",
        )
    except Exception as exc:
        log_event(
            "error",
            "ai.failed",
            f"AI analysis failed for source #{source_id}.",
            brand_id=source["brand_id"],
            source_id=source_id,
            stage="source_analysis",
            details={"model": openai_model_for("source_analysis")},
            duration_ms=int((time.perf_counter() - started_at) * 1000),
            error=str(exc),
        )
        raise
    log_event(
        "info",
        "ai.response_parsed",
        f"AI analysis response parsed for source #{source_id}.",
        brand_id=source["brand_id"],
        source_id=source_id,
        stage="source_analysis",
        details={"model": openai_model_for("source_analysis"), "result_keys": sorted((result or {}).keys())},
        duration_ms=int((time.perf_counter() - started_at) * 1000),
    )
    return create_analysis_result(source, "analyzed", result)


def active_brand_dna(brand_id: int | None = None) -> dict[str, Any] | None:
    brand_id = brand_id or default_brand_id()
    with db_connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM brand_dna_snapshots
            WHERE brand_id = ? AND active = 1
            ORDER BY id DESC LIMIT 1
            """,
            (brand_id,),
        ).fetchone()
    snapshot = row_to_dict(row)
    if not snapshot:
        return None
    result = normalize_brand_dna_payload(parse_json_field(snapshot["result_json"], {}))
    result["_snapshot"] = {
        "id": snapshot["id"],
        "created_at": snapshot["created_at"],
        "manual_overrides": parse_json_field(snapshot["manual_overrides_json"], {}),
        "source_result_ids": parse_json_field(snapshot["source_result_ids_json"], []),
    }
    return result


def save_brand_dna_snapshot(
    brand_id: int,
    result: dict[str, Any],
    *,
    manual_overrides: dict[str, Any] | None = None,
    source_result_ids: list[int] | None = None,
) -> int:
    result = normalize_brand_dna_payload(result)
    with db_connect() as conn:
        conn.execute("UPDATE brand_dna_snapshots SET active = 0 WHERE brand_id = ?", (brand_id,))
        cur = conn.execute(
            """
            INSERT INTO brand_dna_snapshots
            (brand_id, result_json, manual_overrides_json, source_result_ids_json, active, created_at)
            VALUES (?, ?, ?, ?, 1, ?)
            """,
            (
                brand_id,
                to_json(result),
                to_json(manual_overrides or {}),
                to_json(source_result_ids or []),
                utc_now(),
            ),
        )
        return int(cur.lastrowid)


def build_brand_dna(brand_id: int) -> dict[str, Any]:
    log_event(
        "info",
        "brand_dna.started",
        "Started Brand DNA build.",
        brand_id=brand_id,
        stage="brand_dna",
    )
    with db_connect() as conn:
        rows = conn.execute(
            """
            SELECT ar.*, rs.title, rs.source_type
            FROM analysis_results ar
            JOIN raw_sources rs ON rs.id = ar.source_id
            WHERE ar.brand_id = ? AND ar.status = 'analyzed'
            ORDER BY ar.id DESC
            """,
            (brand_id,),
        ).fetchall()
    if not rows:
        raise RuntimeError("撠??????皞?隢??臬鞈?銝血?????")

    latest_by_source: dict[int, dict[str, Any]] = {}
    for row in rows:
        source_id = int(row["source_id"])
        if source_id not in latest_by_source:
            latest_by_source[source_id] = row_to_dict(row) or {}

    analyses = []
    source_result_ids = []
    for item in latest_by_source.values():
        source_result_ids.append(int(item["id"]))
        analyses.append(
            {
                "analysis_id": item["id"],
                "source_id": item["source_id"],
                "source_type": item["source_type"],
                "title": item["title"],
                "result": parse_json_field(item["result_json"], {}),
            }
        )

    archetype_reference = [
        {"key": key, "name_zh": meta["name_zh"], "name_en": meta["name_en"], "role_name": meta["role_name"]}
        for key, meta in BRAND_ARCHETYPES.items()
    ]
    prompt = f"""
Synthesize the analyzed source evidence into a reusable brand data foundation.
Brand DNA may remain the backend data structure, but user-facing output must focus on 12 Brand Archetypes and a complete brand character.

Analyzed source JSON:
{json.dumps(analyses, ensure_ascii=False)[:24000]}

12 Brand Archetypes:
{json.dumps(archetype_reference, ensure_ascii=False)}

Return valid JSON in this exact shape:
{{
  "brand_name": "沒事早事坐",
  "handle": "zao_shih",
  "brand_archetype": {{
    "key": "everyman",
    "name_zh": "凡人",
    "name_en": "The Everyman",
    "role_name": "凡人型品牌",
    "confidence": 0,
    "rationale": "..."
  }},
  "archetype_scores": {{
    "innocent": 0,
    "explorer": 0,
    "sage": 0,
    "hero": 0,
    "outlaw": 0,
    "magician": 0,
    "everyman": 0,
    "lover": 0,
    "jester": 0,
    "caregiver": 0,
    "creator": 0,
    "ruler": 0
  }},
  "archetype_score_explanations": {{
    "everyman": {{
      "explanation": "One concrete paragraph explaining how the brand text matches this archetype, what traits appear, and why the score level makes sense.",
      "evidence": ["Cite source-specific signals or observable brand facts, not generic archetype definitions."]
    }}
  }},
  "brand_character": {{
    "name": "凡人型品牌",
    "positioning": "...",
    "traits": ["..."],
    "voice": "...",
    "visual_personality": "...",
    "target_audience": "...",
    "description": "...",
    "visual_prompt": "..."
  }},
  "positioning": "...",
  "brand_traits": ["..."],
  "visual_personality": "...",
  "keywords": ["..."],
  "forbidden_words": ["..."],
  "tone_guide": {{
    "voice": "...",
    "sentence_style": "...",
    "emoji_usage": "...",
    "do": ["..."],
    "dont": ["..."]
  }},
  "audience_segments": [
    {{"name": "...", "need": "...", "message_angle": "..."}}
  ],
  "content_guidelines": ["..."],
  "summary": "..."
}}
"""
    started_at = time.perf_counter()
    log_event(
        "info",
        "ai.requested",
        "Requested AI Brand DNA build.",
        brand_id=brand_id,
        stage="brand_dna",
        details={"model": openai_model_for("brand_dna"), "analysis_count": len(analyses)},
    )
    try:
        result = normalize_brand_dna_payload(generate_openai_json(
            prompt,
            system_instruction=(
                "You are a senior BrandDNA strategist. Synthesize analyzed raw-source evidence into a stable, practical Brand DNA. "
                "Use the 12 Brand Archetypes as the main brand personality framework. "
                "For the top five archetype scores, write archetype_score_explanations.explanation as one useful paragraph about text-to-archetype fit and brand traits; never split into reason/score-logic sections or use generic ranking phrases. "
                "Write all user-facing text in Traditional Chinese. Do not invent source facts."
            ),
            temperature=0.2,
            max_output_tokens=6000,
            task="brand_dna",
        ))
    except Exception as exc:
        log_event(
            "error",
            "ai.failed",
            "AI Brand DNA build failed.",
            brand_id=brand_id,
            stage="brand_dna",
            details={"model": openai_model_for("brand_dna"), "analysis_count": len(analyses)},
            duration_ms=int((time.perf_counter() - started_at) * 1000),
            error=str(exc),
        )
        raise
    log_event(
        "info",
        "ai.response_parsed",
        "AI Brand DNA response parsed.",
        brand_id=brand_id,
        stage="brand_dna",
        details={"model": openai_model_for("brand_dna"), "result_keys": sorted((result or {}).keys())},
        duration_ms=int((time.perf_counter() - started_at) * 1000),
    )
    snapshot_id = save_brand_dna_snapshot(brand_id, result, source_result_ids=source_result_ids)
    log_event(
        "info",
        "brand_dna.completed",
        f"Brand DNA snapshot #{snapshot_id} created.",
        brand_id=brand_id,
        stage="brand_dna",
        details={"snapshot_id": snapshot_id, "source_result_ids": source_result_ids},
    )
    result["_snapshot_id"] = snapshot_id
    return result


def run_extract_job(job_id: int, source_id: int) -> dict[str, Any]:
    update_job(job_id, "running", mark_started=True)
    result = extract_source_content(source_id)
    status = "done" if result["status"] == "extracted" else "error"
    update_job(job_id, status, result=result, error=result.get("error"), mark_finished=True)
    return result


def run_analyze_job(job_id: int, source_id: int) -> dict[str, Any]:
    update_job(job_id, "running", mark_started=True)
    try:
        result = analyze_source_content(source_id)
    except Exception as exc:
        source = fetch_source(source_id) or {}
        if source:
            result = create_analysis_result(source, "error", error=str(exc))
        else:
            result = {"source_id": source_id, "status": "error", "result": {}, "error": str(exc)}
    status = "done" if result["status"] == "analyzed" else "error"
    update_job(job_id, status, result=result, error=result.get("error"), mark_finished=True)
    return result


def run_pipeline_job(job_id: int, brand_id: int, source_ids: list[int] | None = None) -> dict[str, Any]:
    update_job(job_id, "running", mark_started=True)
    with db_connect() as conn:
        if source_ids:
            placeholders = ",".join("?" for _ in source_ids)
            rows = conn.execute(
                f"SELECT id FROM raw_sources WHERE brand_id = ? AND id IN ({placeholders}) ORDER BY id",
                [brand_id, *source_ids],
            ).fetchall()
        else:
            rows = conn.execute("SELECT id FROM raw_sources WHERE brand_id = ? ORDER BY id", (brand_id,)).fetchall()

    if not rows:
        raise RuntimeError("?桀?瘝??臬???鞈?靘?嚗??憓?頛蝷箇?鞈???")

    extracted = []
    analyzed = []
    errors = []
    for row in rows:
        sid = int(row["id"])
        extraction = latest_extraction(sid)
        if not extraction or extraction["status"] != "extracted":
            extraction = extract_source_content(sid)
        extracted.append({"source_id": sid, "status": extraction["status"], "error": extraction.get("error")})
        if extraction["status"] != "extracted":
            errors.append({"source_id": sid, "stage": "extract", "error": extraction.get("error")})
            continue
        try:
            analysis = analyze_source_content(sid)
        except Exception as exc:
            source = fetch_source(sid) or {}
            analysis = create_analysis_result(source, "error", error=str(exc)) if source else {
                "source_id": sid,
                "status": "error",
                "result": {},
                "error": str(exc),
            }
        analyzed.append({"source_id": sid, "status": analysis["status"], "error": analysis.get("error")})
        if analysis["status"] != "analyzed":
            errors.append({"source_id": sid, "stage": "analyze", "error": analysis.get("error")})

    dna = build_brand_dna(brand_id)
    result = {
        "extracted": extracted,
        "analyzed": analyzed,
        "errors": errors,
        "brand_dna": dna,
    }
    update_job(job_id, "done", result=result, mark_finished=True)
    return result


def run_global_scan_job(job_id: int, brand_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    update_job(job_id, "running", mark_started=True)
    log_event(
        "info",
        "global_scan.started",
        f"Started global scan job #{job_id}.",
        brand_id=brand_id,
        job_id=job_id,
        stage="global_scan",
    )
    source_specs, invalid_urls = collect_global_scan_sources(payload)
    if invalid_urls:
        raise GlobalScanError("部分 URL 格式無效，請使用 http:// 或 https:// 開頭的完整網址。", 400)
    if len(source_specs) < 3:
        raise GlobalScanError("資料來源不足，請至少提供 3 種來源。", 400)

    source_ids: list[int] = []
    url_source_ids: set[int] = set()
    created_sources: list[dict[str, Any]] = []
    scan_metadata = {
        "global_scan_id": job_id,
        "automation": "public_url",
        "crawl_strategy": "public_page_first",
    }

    for spec in source_specs:
        source_type = str(spec.get("source_type") or "custom")
        input_kind = str(spec.get("input_kind") or "url")
        url = spec.get("url")
        title = spec.get("title") or (
            f"{source_type_label(source_type)} 手動輸入"
            if input_kind == "text"
            else f"{source_type_label(source_type)} URL 擷取"
        )
        source_metadata = {
            **scan_metadata,
            **(spec.get("metadata") if isinstance(spec.get("metadata"), dict) else {}),
            "source_url_kind": source_type,
        }
        if input_kind == "text":
            source_metadata.setdefault("automation", "manual_in_global_scan")
            source_id = create_text_source(
                brand_id,
                source_type,
                title,
                str(spec.get("content") or ""),
                url=url,
                metadata=source_metadata,
            )
        else:
            source_id = insert_raw_source(
                brand_id,
                source_type,
                "url",
                title,
                url=url,
                metadata=source_metadata,
            )
        source_ids.append(source_id)
        if input_kind == "url":
            url_source_ids.add(source_id)
        created_sources.append({"id": source_id, "source_type": source_type, "url": url, "input_kind": input_kind})
        log_event(
            "info",
            "global_scan.source_created",
            f"Global scan source #{source_id} created.",
            brand_id=brand_id,
            job_id=job_id,
            source_id=source_id,
            stage=source_type,
            details={"source_type": source_type, "url": url},
        )

    selected_rules = normalize_selected_rules(payload.get("selected_rules"))
    if selected_rules:
        rules_text = "\n".join(f"- {rule}" for rule in selected_rules)
        content = (
            "Selected compliance rules for this scan:\n"
            f"{rules_text}\n\n"
            "Use these rules as compliance context during analysis."
        )
        source_id = create_text_source(
            brand_id,
            "compliance_rule",
            "店家選擇的法規規範",
            content,
            metadata={
                "global_scan_id": job_id,
                "automation": "selected_rules",
                "selected_rules": selected_rules,
            },
        )
        source_ids.append(source_id)
        created_sources.append({"id": source_id, "source_type": "compliance_rule", "input_kind": "text"})

    internal_rules = str(payload.get("internal_rules") or "").strip()
    if internal_rules:
        source_id = create_text_source(
            brand_id,
            "internal_rule",
            "摨振?折?Ｘ?閬?",
            internal_rules,
            metadata={"global_scan_id": job_id, "automation": "internal_rule"},
        )
        source_ids.append(source_id)
        created_sources.append({"id": source_id, "source_type": "internal_rule", "input_kind": "text"})

    extracted = []
    analyzed = []
    errors = []
    successful_source_ids: set[int] = set()
    successful_url_source_ids: set[int] = set()

    for source_id in source_ids:
        source = fetch_source(source_id) or {}
        log_event(
            "info",
            "global_scan.source_started",
            f"Processing source #{source_id} in global scan.",
            brand_id=brand_id,
            job_id=job_id,
            source_id=source_id,
            stage=source.get("source_type"),
            details={"source_type": source.get("source_type"), "input_kind": source.get("input_kind")},
        )
        extraction = extract_source_content(source_id)
        extracted.append(
            {
                "source_id": source_id,
                "source_type": source.get("source_type"),
                "status": extraction["status"],
                "error": extraction.get("error"),
            }
        )
        if extraction["status"] != "extracted":
            errors.append({"source_id": source_id, "stage": "extract", "error": extraction.get("error")})
            log_event(
                "warning",
                "global_scan.source_failed",
                f"Source #{source_id} failed during extraction.",
                brand_id=brand_id,
                job_id=job_id,
                source_id=source_id,
                stage="extract",
                details={"source_type": source.get("source_type"), "status": extraction["status"]},
                error=extraction.get("error"),
            )
            continue
        successful_source_ids.add(source_id)
        if source_id in url_source_ids:
            successful_url_source_ids.add(source_id)
        try:
            analysis = analyze_source_content(source_id)
        except Exception as exc:
            analysis = create_analysis_result(source, "error", error=str(exc))
        analyzed.append(
            {
                "source_id": source_id,
                "source_type": source.get("source_type"),
                "status": analysis["status"],
                "error": analysis.get("error"),
            }
        )
        if analysis["status"] != "analyzed":
            errors.append({"source_id": source_id, "stage": "analyze", "error": analysis.get("error")})
            log_event(
                "warning",
                "global_scan.source_failed",
                f"Source #{source_id} failed during analysis.",
                brand_id=brand_id,
                job_id=job_id,
                source_id=source_id,
                stage="analyze",
                details={"source_type": source.get("source_type"), "status": analysis["status"]},
                error=analysis.get("error"),
            )
        else:
            log_event(
                "info",
                "global_scan.source_completed",
                f"Source #{source_id} completed in global scan.",
                brand_id=brand_id,
                job_id=job_id,
                source_id=source_id,
                stage=source.get("source_type"),
                details={"source_type": source.get("source_type")},
            )

    result: dict[str, Any] = {
        "global_scan_id": job_id,
        "created_sources": created_sources,
        "source_ids": source_ids,
        "url_source_ids": sorted(url_source_ids),
        "successful_source_ids": sorted(successful_source_ids),
        "successful_url_source_ids": sorted(successful_url_source_ids),
        "extracted": extracted,
        "analyzed": analyzed,
        "errors": errors,
    }

    if not successful_source_ids:
        message = "No source was successfully extracted. Please check the input URLs or provide manual text."
        update_job(job_id, "error", result=result, error=message, mark_finished=True)
        raise GlobalScanError(message, 422)

    if not any(item["status"] == "analyzed" for item in analyzed):
        message = "資料來源已建立並嘗試整理，但智慧分析尚未完成。請確認 OPENAI_API_KEY 與 openai 套件設定後，再按「重新建立品牌角色」或逐筆重新分析。"
        update_job(job_id, "error", result=result, error=message, mark_finished=True)
        raise GlobalScanError(message, 424)

    try:
        log_event(
            "info",
            "global_scan.brand_dna_started",
            f"Building Brand DNA for global scan job #{job_id}.",
            brand_id=brand_id,
            job_id=job_id,
            stage="brand_dna",
        )
        dna = build_brand_dna(brand_id)
    except Exception as exc:
        message = (
            "Sources were extracted and analyzed, but Brand DNA generation failed. "
            "Check OpenAI configuration and try rebuilding Brand DNA."
        )
        update_job(job_id, "error", result=result, error=f"{message} Error: {exc}", mark_finished=True)
        raise GlobalScanError(message, 424) from exc

    result["brand_dna"] = dna
    update_job(job_id, "done", result=result, mark_finished=True)
    log_event(
        "info",
        "global_scan.completed",
        f"Completed global scan job #{job_id}.",
        brand_id=brand_id,
        job_id=job_id,
        stage="global_scan",
        details={
            "source_count": len(source_ids),
            "successful_url_source_count": len(successful_url_source_ids),
            "error_count": len(errors),
            "brand_snapshot_id": dna.get("_snapshot_id") if isinstance(dna, dict) else None,
        },
    )
    return result


def normalize_brand_dna_payload(result: dict[str, Any]) -> dict[str, Any]:
    """Normalize legacy scores and add the current 12-archetype brand role fields."""
    if not isinstance(result, dict):
        return result
    normalized = dict(result)
    scores = normalized.get("personality_scores")
    if isinstance(scores, dict):
        normalized["personality_scores"] = normalize_numeric_score_map(scores)

    archetype_scores = normalized.get("archetype_scores")
    if isinstance(archetype_scores, dict):
        fixed_archetype_scores = normalize_numeric_score_map(archetype_scores)
        normalized["archetype_scores"] = {
            normalize_archetype_key(key) or str(key): value
            for key, value in fixed_archetype_scores.items()
        }
    else:
        normalized["archetype_scores"] = {}

    primary = primary_archetype_payload(normalized)
    normalized["brand_archetype"] = primary
    normalized["archetype"] = primary["role_name"]
    if primary["key"] not in normalized["archetype_scores"]:
        normalized["archetype_scores"][primary["key"]] = primary.get("confidence", 80)
    normalized["brand_character"] = brand_character_payload(normalized, primary)
    return normalized


def normalize_numeric_score_map(scores: dict[str, Any]) -> dict[str, Any]:
    numeric_values = []
    parsed_scores: dict[str, float] = {}
    for key, value in scores.items():
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            continue
        parsed_scores[str(key)] = parsed
        numeric_values.append(parsed)

    if not numeric_values:
        return dict(scores)

    max_score = max(numeric_values)
    if 0 < max_score <= 1:
        multiplier = 100
    elif 0 < max_score <= 10:
        multiplier = 10
    else:
        multiplier = 1

    fixed_scores = dict(scores)
    for key, value in parsed_scores.items():
        fixed = max(0, min(100, value * multiplier))
        fixed_scores[key] = int(fixed) if fixed.is_integer() else round(fixed, 1)
    return fixed_scores


def normalize_archetype_key(value: Any) -> str | None:
    raw = str(value or "").strip().lower()
    if not raw:
        return None
    raw = raw.replace("the ", "").replace("型品牌", "").replace("品牌", "").strip()
    aliases = {
        "innocent": "innocent",
        "天真者": "innocent",
        "explorer": "explorer",
        "探險家": "explorer",
        "sage": "sage",
        "智者": "sage",
        "hero": "hero",
        "英雄": "hero",
        "outlaw": "outlaw",
        "叛逆者": "outlaw",
        "亡命之徒": "outlaw",
        "magician": "magician",
        "魔法師": "magician",
        "everyman": "everyman",
        "凡人": "everyman",
        "lover": "lover",
        "愛人": "lover",
        "jester": "jester",
        "小丑": "jester",
        "caregiver": "caregiver",
        "照顧者": "caregiver",
        "creator": "creator",
        "創造者": "creator",
        "ruler": "ruler",
        "統治者": "ruler",
    }
    if raw in aliases:
        return aliases[raw]
    for key, meta in BRAND_ARCHETYPES.items():
        candidates = [key, meta["name_en"].lower().replace("the ", ""), meta["name_zh"]]
        if any(candidate and candidate in raw for candidate in candidates):
            return key
    return None


def archetype_meta(key: str | None) -> dict[str, str]:
    return BRAND_ARCHETYPES.get(key or "", BRAND_ARCHETYPES["everyman"])


def primary_archetype_payload(dna: dict[str, Any]) -> dict[str, Any]:
    raw = dna.get("brand_archetype") if isinstance(dna.get("brand_archetype"), dict) else {}
    key = normalize_archetype_key(raw.get("key") or raw.get("name_zh") or raw.get("name_en") or dna.get("archetype_key") or dna.get("archetype"))
    scores = dna.get("archetype_scores") if isinstance(dna.get("archetype_scores"), dict) else {}
    if not key and scores:
        key = max(scores, key=lambda item: clamp_score(scores.get(item), 0))
        key = normalize_archetype_key(key) or key
    if not key:
        key = "everyman"
    meta = archetype_meta(key)
    confidence = clamp_score(raw.get("confidence") or scores.get(key), 80)
    return {
        "key": key,
        "name_zh": raw.get("name_zh") or meta["name_zh"],
        "name_en": raw.get("name_en") or meta["name_en"],
        "role_name": raw.get("role_name") or meta["role_name"],
        "confidence": confidence,
        "rationale": raw.get("rationale") or dna.get("summary") or meta["description"],
        "description": raw.get("description") or meta["description"],
    }


def audience_text_from_segments(segments: Any) -> str:
    if not isinstance(segments, list) or not segments:
        return ""
    first = segments[0]
    if isinstance(first, dict):
        parts = [first.get("name"), first.get("need"), first.get("message_angle")]
        return "：".join(str(part) for part in parts if part)
    return str(first)


def brand_character_payload(dna: dict[str, Any], primary: dict[str, Any] | None = None) -> dict[str, Any]:
    primary = primary or primary_archetype_payload(dna)
    character = dna.get("brand_character") if isinstance(dna.get("brand_character"), dict) else {}
    tone = dna.get("tone_guide") if isinstance(dna.get("tone_guide"), dict) else {}
    audience = (
        character.get("target_audience")
        or dna.get("target_audience")
        or audience_text_from_segments(dna.get("audience_segments"))
        or "重視品牌風格、產品品質與穩定體驗的核心客群"
    )
    traits = character.get("traits") or dna.get("brand_traits") or dna.get("keywords") or []
    if isinstance(traits, str):
        traits = [traits]
    payload = {
        "name": character.get("name") or primary["role_name"],
        "archetype_key": primary["key"],
        "archetype": primary["role_name"],
        "positioning": character.get("positioning") or dna.get("positioning") or dna.get("summary") or primary["description"],
        "traits": traits[:8],
        "voice": character.get("voice") or tone.get("voice") or "自然、清楚、符合品牌個性",
        "visual_personality": character.get("visual_personality") or dna.get("visual_personality") or "延續品牌色彩、產品情境與社群可讀性",
        "target_audience": audience,
        "description": character.get("description") or dna.get("summary") or primary["description"],
        "visual_prompt": character.get("visual_prompt") or "",
    }
    if isinstance(character.get("character_image"), dict):
        payload["character_image"] = character["character_image"]
    return payload


def clean_display_text(value: Any, max_length: int = 220) -> str:
    text = str(value or "").strip()
    if not text or "\ufffd" in text:
        return ""
    text = re.sub(r"\s+", " ", text)
    if len(text) > max_length:
        return text[:max_length].rstrip() + "..."
    return text


def clean_display_list(value: Any, *, limit: int = 3, max_length: int = 140) -> list[str]:
    if isinstance(value, str):
        candidates: list[Any] = [value]
    elif isinstance(value, list):
        candidates = value
    else:
        candidates = []

    cleaned: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        if isinstance(item, dict):
            item = item.get("text") or item.get("reasoning") or item.get("reason") or item.get("title")
        text = clean_display_text(item, max_length=max_length)
        if text and text not in seen:
            cleaned.append(text)
            seen.add(text)
        if len(cleaned) >= limit:
            break
    return cleaned


GENERIC_ARCHETYPE_DETAIL_PHRASES = (
    "分數進入前五",
    "0-100 適配度",
    "目前可讀資料",
    "具體文本線索不足",
    "目前缺少更細的來源 reasoning",
    "目前資料未提供更多來源線索",
    "原始資料未提供此人格",
    "完整人格光譜中的參考分數",
)


def clean_archetype_detail_text(value: Any, max_length: int = 360) -> str:
    text = clean_display_text(value, max_length=max_length)
    if not text:
        return ""
    if any(phrase in text for phrase in GENERIC_ARCHETYPE_DETAIL_PHRASES):
        return ""
    return text


def clean_archetype_evidence(value: Any, *, limit: int = 3) -> list[str]:
    return [
        text
        for text in clean_display_list(value, limit=limit, max_length=140)
        if not any(phrase in text for phrase in GENERIC_ARCHETYPE_DETAIL_PHRASES)
    ]


def archetype_dimension_detail_map(dimensions: Any) -> dict[str, dict[str, Any]]:
    details: dict[str, dict[str, Any]] = {}
    if isinstance(dimensions, dict):
        dimension_items = []
        for key, value in dimensions.items():
            if isinstance(value, dict):
                dimension_items.append({"key": key, **value})
            else:
                dimension_items.append({"key": key, "reason": value})
    elif isinstance(dimensions, list):
        dimension_items = dimensions
    else:
        return details
    for row in dimension_items:
        if not isinstance(row, dict):
            continue
        key = normalize_archetype_key(row.get("key") or row.get("name") or row.get("label") or row.get("archetype"))
        if not key:
            continue
        evidence = clean_archetype_evidence(
            row.get("evidence")
            or row.get("source_evidence")
            or row.get("signals")
            or row.get("positive_signals")
        )
        limiting_factors = clean_archetype_evidence(row.get("limiting_factors") or row.get("limits") or row.get("weak_signals"), limit=2)
        score_logic = clean_archetype_detail_text(row.get("score_logic") or row.get("logic") or row.get("scoring_logic"))
        if not score_logic and limiting_factors:
            score_logic = f"加分來自：{'；'.join(evidence or [])}。分數受限於：{'；'.join(limiting_factors)}。"
        details[key] = {
            "explanation": clean_archetype_detail_text(row.get("explanation") or row.get("description") or row.get("analysis")),
            "reason": clean_archetype_detail_text(row.get("reason") or row.get("rationale") or row.get("why")),
            "score_logic": score_logic,
            "evidence": evidence,
        }
    return details


def source_archetype_evidence_from_analyses(analyses: Any) -> dict[str, list[str]]:
    evidence: dict[str, list[str]] = {key: [] for key in BRAND_ARCHETYPES}
    if not isinstance(analyses, list):
        return evidence
    for item in analyses:
        if not isinstance(item, dict):
            continue
        result = item.get("result") if isinstance(item.get("result"), dict) else item
        signals = result.get("archetype_signals") if isinstance(result, dict) else {}
        scores = signals.get("scores") if isinstance(signals, dict) else {}
        if not isinstance(scores, dict):
            continue
        source_name = clean_display_text(item.get("title") or item.get("source_type"), max_length=36)
        for raw_key, payload in scores.items():
            key = normalize_archetype_key(raw_key)
            if not key:
                continue
            reasoning = payload.get("reasoning") if isinstance(payload, dict) else ""
            text = clean_display_text(reasoning, max_length=120)
            if not text:
                continue
            if source_name:
                text = f"{source_name}：{text}"
            if text not in evidence[key]:
                evidence[key].append(text)
    return {key: values[:3] for key, values in evidence.items()}


def evidence_summary(evidence: list[str], limit: int = 2) -> str:
    cleaned = clean_display_list(evidence, limit=limit, max_length=120)
    return "；".join(cleaned)


def fallback_archetype_reason(key: str, score: int, primary: dict[str, Any], evidence: list[str]) -> str:
    meta = BRAND_ARCHETYPES[key]
    signal_text = evidence_summary(evidence)
    if signal_text:
        return f"入選主因是來源資料出現「{signal_text}」。這些線索對應到「{meta['name_zh']}」重視的{meta['description']}"
    if key == primary.get("key"):
        rationale = clean_display_text(primary.get("rationale"))
        if rationale:
            return rationale
    if score >= 70:
        return f"分數進入前五，代表品牌資料中已明顯出現「{meta['description']}」的原型訊號。"
    if score > 0:
        return f"分數進入前五，代表目前資料仍可看見部分「{meta['description']}」相關線索。"
    return "目前資料中此人格訊號不足，分數主要作為完整 12 原型比較的低權重參考。"


def score_band_label(score: int) -> str:
    if score >= 80:
        return "核心人格"
    if score >= 60:
        return "強次要人格"
    if score >= 35:
        return "輔助訊號"
    if score > 0:
        return "弱訊號"
    return "未見明確訊號"


def fallback_archetype_score_logic(
    key: str,
    rank: int,
    score: int,
    top_key: str,
    top_score: int,
    evidence: list[str],
) -> str:
    gap = max(top_score - score, 0)
    band = score_band_label(score)
    signal_text = evidence_summary(evidence, limit=1)
    top_name = BRAND_ARCHETYPES.get(top_key, {}).get("role_name", "最高分人格")
    if rank == 1:
        comparison = f"它高於第二梯隊，代表目前品牌敘事最集中在「{BRAND_ARCHETYPES[key]['name_zh']}」而非其他原型。"
    else:
        comparison = f"它與最高分「{top_name}」差 {gap} 分，因此較適合視為輔助人格，而不是主要品牌核心。"
    signal_clause = f"主要加分線索是「{signal_text}」。" if signal_text else "目前缺少更細的來源 reasoning，因此以 Brand DNA 綜合分數與品牌角色欄位判讀。"
    return f"{score}/100 屬於「{band}」。{signal_clause}{comparison}"


def fallback_archetype_explanation(
    dna: dict[str, Any],
    key: str,
    rank: int,
    score: int,
    primary: dict[str, Any],
    top_key: str,
    top_score: int,
    evidence: list[str],
) -> str:
    meta = BRAND_ARCHETYPES[key]
    band = score_band_label(score)
    signal_text = evidence_summary(evidence, limit=3)
    if signal_text:
        signal_sentence = f"這個人格的主要吻合點來自：{signal_text}。"
    elif key == primary.get("key"):
        signal_sentence = clean_display_text(primary.get("rationale")) or f"品牌主軸與「{meta['name_zh']}」的原型特質接近。"
    else:
        character = dna.get("brand_character") if isinstance(dna.get("brand_character"), dict) else {}
        tone = dna.get("tone_guide") if isinstance(dna.get("tone_guide"), dict) else {}
        traits = character.get("traits") or dna.get("brand_traits") or dna.get("keywords") or []
        if isinstance(traits, str):
            traits = [traits]
        context_parts = clean_display_list(
            [
                character.get("positioning") or dna.get("positioning") or dna.get("summary"),
                f"品牌特質包含「{'、'.join(traits[:5])}」" if traits else "",
                f"語氣偏向「{character.get('voice') or tone.get('voice')}」" if character.get("voice") or tone.get("voice") else "",
                f"主要溝通對象是「{character.get('target_audience')}」" if character.get("target_audience") else "",
            ],
            limit=4,
            max_length=160,
        )
        signal_sentence = f"目前 Brand DNA 顯示：{'；'.join(context_parts)}。" if context_parts else f"品牌角色欄位仍保留了「{meta['name_zh']}」的部分訊號。"

    if rank == 1:
        weight_sentence = f"{score}/100 屬於「{band}」，是本次最高分，表示品牌文本最集中呈現「{meta['name_zh']}」的{meta['description']}"
    else:
        gap = max(top_score - score, 0)
        top_name = BRAND_ARCHETYPES.get(top_key, {}).get("role_name", "最高分人格")
        weight_sentence = f"{score}/100 屬於「{band}」，與最高分「{top_name}」差 {gap} 分，較適合視為品牌的輔助人格特質。"
    return f"{signal_sentence}{weight_sentence}"


def fallback_archetype_evidence(key: str, dna: dict[str, Any], primary: dict[str, Any]) -> list[str]:
    character = dna.get("brand_character") if isinstance(dna.get("brand_character"), dict) else {}
    tone = dna.get("tone_guide") if isinstance(dna.get("tone_guide"), dict) else {}
    candidates: list[Any] = []
    if key == primary.get("key"):
        candidates.append(primary.get("rationale"))
    candidates.extend([
        character.get("positioning"),
        character.get("voice"),
        tone.get("voice") if isinstance(tone, dict) else "",
        dna.get("summary"),
        BRAND_ARCHETYPES[key]["description"],
    ])
    return clean_display_list(candidates, limit=3)


def build_archetype_dimensions(
    dna: dict[str, Any],
    raw_dimensions: Any = None,
    source_evidence: dict[str, list[str]] | None = None,
) -> list[dict[str, Any]]:
    dna = normalize_brand_dna_payload(dna or {})
    primary = dna.get("brand_archetype") or primary_archetype_payload(dna)
    scores = dna.get("archetype_scores") if isinstance(dna.get("archetype_scores"), dict) else {}
    detail_map = archetype_dimension_detail_map(dna.get("archetype_score_explanations"))
    detail_map.update(archetype_dimension_detail_map(raw_dimensions))
    source_evidence = source_evidence or {}

    score_by_key = {key: clamp_score(scores.get(key), 0) for key in BRAND_ARCHETYPES}
    ordered_keys = sorted(BRAND_ARCHETYPES, key=lambda key: (-score_by_key[key], list(BRAND_ARCHETYPES).index(key)))
    top_key = ordered_keys[0] if ordered_keys else "everyman"
    top_score = score_by_key[top_key] if ordered_keys else 0
    dimensions: list[dict[str, Any]] = []
    for rank, key in enumerate(ordered_keys, start=1):
        meta = BRAND_ARCHETYPES[key]
        score = score_by_key[key]
        detail = detail_map.get(key, {})
        evidence = (
            detail.get("evidence")
            or clean_display_list(source_evidence.get(key), limit=3)
            or fallback_archetype_evidence(key, dna, primary)
        )
        dimensions.append(
            {
                "key": key,
                "name": meta["role_name"],
                "score": score,
                "rank": rank,
                "is_top_five": rank <= 5,
                "explanation": detail.get("explanation")
                or fallback_archetype_explanation(dna, key, rank, score, primary, top_key, top_score, evidence),
                "reason": detail.get("reason") or fallback_archetype_reason(key, score, primary, evidence),
                "score_logic": detail.get("score_logic") or fallback_archetype_score_logic(key, rank, score, top_key, top_score, evidence),
                "evidence": evidence,
            }
        )
    return dimensions


def normalize_scores(brand_dna: dict[str, Any]) -> dict[str, Any]:
    scores = brand_dna.get("personality_scores") or {}
    if not scores:
        scores = {k: brand_dna.get(k, 0) for k in PERSONALITY_DIMENSIONS}
    return normalize_brand_dna_payload({"personality_scores": scores}).get("personality_scores", scores)


def brand_dna_prompt_block(brand_dna: dict[str, Any]) -> str:
    brand_dna = normalize_brand_dna_payload(brand_dna)
    primary = brand_dna.get("brand_archetype") or primary_archetype_payload(brand_dna)
    character = brand_dna.get("brand_character") or brand_character_payload(brand_dna, primary)
    archetype_score_lines = [
        f"- {BRAND_ARCHETYPES[key]['role_name']} ({key}): {clamp_score(value)}/100"
        for key, value in (brand_dna.get("archetype_scores") or {}).items()
        if key in BRAND_ARCHETYPES
    ]
    tone = brand_dna.get("tone_guide", {})
    return "\n".join(
        [
            f"Summary: {brand_dna.get('summary', '')}",
            f"Primary brand archetype: {primary.get('role_name')} / {primary.get('name_en')} ({primary.get('confidence')}/100)",
            f"Archetype rationale: {primary.get('rationale', '')}",
            "Brand character:",
            f"- Name: {character.get('name', '')}",
            f"- Positioning: {character.get('positioning', '')}",
            f"- Traits: {', '.join(character.get('traits', [])) if isinstance(character.get('traits'), list) else character.get('traits', '')}",
            f"- Voice: {character.get('voice', '')}",
            f"- Visual personality: {character.get('visual_personality', '')}",
            f"- Target audience: {character.get('target_audience', '')}",
            "Archetype scores:",
            *(archetype_score_lines or ["- No detailed archetype scores available."]),
            f"Keywords: {', '.join(brand_dna.get('keywords', []))}",
            f"Forbidden words: {', '.join(brand_dna.get('forbidden_words', []))}",
            f"Tone guide: {json.dumps(tone, ensure_ascii=False)}",
        ]
    )


def brand_character_image_prompt_input(brand_dna: dict[str, Any]) -> dict[str, Any]:
    brand_dna = normalize_brand_dna_payload(brand_dna)
    primary = brand_dna.get("brand_archetype") or primary_archetype_payload(brand_dna)
    character = brand_dna.get("brand_character") or brand_character_payload(brand_dna, primary)
    dimensions = build_archetype_dimensions(brand_dna)
    top_archetypes = [
        {
            "key": row["key"],
            "name": row["name"],
            "score": row["score"],
            "rank": row["rank"],
            "description": BRAND_ARCHETYPES[row["key"]]["description"],
        }
        for row in dimensions[:5]
    ]
    return {
        "brand_name": brand_dna.get("brand_name") or brand_dna.get("name") or DEFAULT_BRAND["name"],
        "summary": brand_dna.get("summary", ""),
        "primary_archetype": primary,
        "top_archetypes": top_archetypes,
        "positioning": character.get("positioning", ""),
        "traits": character.get("traits", []),
        "voice": character.get("voice", ""),
        "visual_personality": character.get("visual_personality", ""),
        "target_audience": character.get("target_audience", ""),
        "description": character.get("description", ""),
        "keywords": brand_dna.get("keywords", []),
        "forbidden_words": brand_dna.get("forbidden_words", []),
    }


def fallback_brand_character_image_prompt(prompt_input: dict[str, Any]) -> dict[str, Any]:
    primary = prompt_input.get("primary_archetype") or {}
    top = prompt_input.get("top_archetypes") or []
    top_text = ", ".join(
        f"{item.get('name')} {item.get('score')}/100" for item in top[:5] if item.get("name")
    )
    traits = prompt_input.get("traits") or prompt_input.get("keywords") or []
    if isinstance(traits, str):
        traits = [traits]
    english_prompt = (
        "Full-body brand ambassador character portrait, vertical composition, 3/4 view, complete body visible, "
        "not cropped, friendly approachable restaurant brand persona. "
        f"Brand: {prompt_input.get('brand_name')}. "
        f"Core archetype: {primary.get('role_name')} / {primary.get('name_en')}. "
        f"Secondary archetype influences: {top_text}. "
        f"Positioning: {prompt_input.get('positioning')}. "
        f"Traits: {', '.join(str(item) for item in traits[:8])}. "
        f"Voice: {prompt_input.get('voice')}. Visual personality: {prompt_input.get('visual_personality')}. "
        "Design a polished original non-celebrity character with clothing, posture, expression, simple props, and a subtle background "
        "that reflect the brand positioning. No readable text, no logos, no real people, no copyrighted characters, no medical or exaggerated claims."
    )
    return {
        "english_prompt": english_prompt,
        "prompt_preview_zh": "以品牌主原型、前五人格分數、定位、特色與視覺個性，生成完整不裁切的直式品牌代言角色圖。",
        "used_inputs": prompt_input,
        "style_keywords": ["full-body character", "brand ambassador", "vertical portrait", "restaurant brand"],
    }


def normalize_brand_character_image_prompt_result(result: Any, prompt_input: dict[str, Any]) -> dict[str, Any]:
    fallback = fallback_brand_character_image_prompt(prompt_input)
    if not isinstance(result, dict):
        return fallback
    normalized = dict(result)
    english_prompt = clean_display_text(normalized.get("english_prompt"), max_length=32000)
    if not english_prompt:
        english_prompt = fallback["english_prompt"]
    mandatory_constraints = (
        "Mandatory generation constraints: vertical 1024x1536 composition, full-body character, complete body visible, "
        "3/4 view, no cropping, no readable text, no logos, no real people, no celebrities, no copyrighted characters, "
        "no medical claims, no legal claims, no exaggerated promises."
    )
    if "Mandatory generation constraints" not in english_prompt:
        english_prompt = f"{english_prompt}\n\n{mandatory_constraints}"
    preview = clean_display_text(normalized.get("prompt_preview_zh"), max_length=1200) or fallback["prompt_preview_zh"]
    style_keywords = normalized.get("style_keywords")
    if not isinstance(style_keywords, list):
        style_keywords = fallback["style_keywords"]
    return {
        "english_prompt": english_prompt,
        "prompt_preview_zh": preview,
        "used_inputs": normalized.get("used_inputs") if isinstance(normalized.get("used_inputs"), dict) else prompt_input,
        "style_keywords": [str(item).strip() for item in style_keywords if str(item).strip()][:12],
    }


def generate_brand_character_image_bytes(
    client: Any,
    prompt: str,
    *,
    size: str,
    quality: str,
    model: str,
) -> bytes:
    result = client.images.generate(
        model=model,
        prompt=prompt,
        size=size,
        quality=quality,
    )
    data = getattr(result, "data", None)
    if data is None and isinstance(result, dict):
        data = result.get("data")
    first = data[0] if data else None
    image_base64 = getattr(first, "b64_json", None)
    if image_base64 is None and isinstance(first, dict):
        image_base64 = first.get("b64_json")
    if not image_base64:
        raise RuntimeError("圖片生成沒有回傳可儲存的 base64 圖片資料。")
    return base64.b64decode(image_base64)


def write_character_image_to_brand_dna(
    brand_id: int,
    brand_dna: dict[str, Any],
    image_info: dict[str, Any],
) -> int:
    source_result_ids = []
    if isinstance(brand_dna.get("_snapshot"), dict):
        source_result_ids = brand_dna["_snapshot"].get("source_result_ids") or []
    updated = {key: value for key, value in brand_dna.items() if not str(key).startswith("_")}
    character = updated.get("brand_character") if isinstance(updated.get("brand_character"), dict) else {}
    updated["brand_character"] = {**character, "character_image": image_info}
    return save_brand_dna_snapshot(
        brand_id,
        updated,
        manual_overrides={"character_image_artifact_id": image_info.get("artifact_id")},
        source_result_ids=source_result_ids,
    )


def get_or_error_brand_dna() -> dict[str, Any]:
    brand_id = default_brand_id()
    dna = active_brand_dna(brand_id)
    if not dna:
        raise RuntimeError("撠撱箇???DNA???鞈?銝剖??啣?鞈?銝血遣蝡??NA??")
    return dna


def serialize_source(source: dict[str, Any]) -> dict[str, Any]:
    source["metadata"] = parse_json_field(source.pop("metadata_json", None), {})
    source["title"] = clean_legacy_source_title(source)
    extraction = latest_extraction(int(source["id"]))
    analysis = latest_analysis(int(source["id"]))
    source["latest_extraction"] = {
        **extraction,
        "metadata": parse_json_field(extraction.get("metadata_json"), {}) if extraction else {},
    } if extraction else None
    if source["latest_extraction"]:
        source["latest_extraction"].pop("metadata_json", None)
        source["latest_extraction"]["extracted_text"] = clean_legacy_source_text(
            source["latest_extraction"].get("extracted_text") or "",
            source,
        )
    source["latest_analysis"] = {
        **analysis,
        "result": parse_json_field(analysis.get("result_json"), {}) if analysis else {},
    } if analysis else None
    if source["latest_analysis"]:
        source["latest_analysis"].pop("result_json", None)
    return source


def serialize_artifact(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = row_to_dict(row) if isinstance(row, sqlite3.Row) else dict(row)
    payload = parse_json_field(item.pop("payload_json", None), {})
    summary = ""
    if isinstance(payload, dict):
        result_payload = payload.get("result") if isinstance(payload.get("result"), dict) else {}
        top_segments = result_payload.get("top_segments") if isinstance(result_payload.get("top_segments"), list) else []
        top_segment_name = top_segments[0].get("audience") if top_segments and isinstance(top_segments[0], dict) else ""
        summary = (
            payload.get("final_caption")
            or payload.get("personality_narrative")
            or payload.get("summary")
            or payload.get("safe_content")
            or payload.get("best_segment")
            or top_segment_name
            or ""
        )
        if isinstance(summary, dict):
            summary = json.dumps(summary, ensure_ascii=False)
    item["payload"] = payload
    item["summary"] = str(summary or item.get("title") or "")[:160]
    return item


def dashboard_summary_payload(brand_id: int) -> dict[str, Any]:
    with db_connect() as conn:
        source_count = conn.execute("SELECT COUNT(*) c FROM raw_sources WHERE brand_id = ?", (brand_id,)).fetchone()["c"]
        extracted_count = conn.execute(
            "SELECT COUNT(DISTINCT source_id) c FROM extraction_results WHERE brand_id = ? AND status = 'extracted'",
            (brand_id,),
        ).fetchone()["c"]
        analysis_count = conn.execute(
            "SELECT COUNT(DISTINCT source_id) c FROM analysis_results WHERE brand_id = ? AND status = 'analyzed'",
            (brand_id,),
        ).fetchone()["c"]
        artifact_count = conn.execute("SELECT COUNT(*) c FROM artifacts WHERE brand_id = ?", (brand_id,)).fetchone()["c"]
        sources_by_status = conn.execute(
            "SELECT status, COUNT(*) c FROM raw_sources WHERE brand_id = ? GROUP BY status",
            (brand_id,),
        ).fetchall()
    dna = active_brand_dna(brand_id)
    return {
        "brand_dna_configured": bool(dna),
        "data_sources_count": source_count,
        "extracted_count": extracted_count,
        "analyses_count": analysis_count,
        "generated_content_count": artifact_count,
        "sources_by_status": {row["status"]: row["c"] for row in sources_by_status},
        "brand_dna": dna,
    }


def latest_analyzed_source_payloads(brand_id: int, limit: int = 12) -> list[dict[str, Any]]:
    with db_connect() as conn:
        rows = conn.execute(
            """
            SELECT ar.*, rs.source_type, rs.title
            FROM analysis_results ar
            JOIN raw_sources rs ON rs.id = ar.source_id
            WHERE ar.brand_id = ? AND ar.status = 'analyzed'
            ORDER BY ar.id DESC
            LIMIT ?
            """,
            (brand_id, limit),
        ).fetchall()
    analyses: list[dict[str, Any]] = []
    seen_sources: set[int] = set()
    for row in rows:
        source_id = int(row["source_id"])
        if source_id in seen_sources:
            continue
        seen_sources.add(source_id)
        analyses.append(
            {
                "source_type": row["source_type"],
                "title": row["title"],
                "result": parse_json_field(row["result_json"], {}),
            }
        )
    return analyses


def reset_brand_workspace(brand_id: int) -> dict[str, int]:
    tables = [
        "usage_events",
        "artifacts",
        "jobs",
        "brand_dna_snapshots",
        "analysis_results",
        "extraction_results",
        "raw_sources",
    ]
    deleted: dict[str, int] = {}
    with db_connect() as conn:
        for table in tables:
            cursor = conn.execute(f"DELETE FROM {table} WHERE brand_id = ?", (brand_id,))
            deleted[table] = cursor.rowcount if cursor.rowcount is not None else 0
    return deleted


def latest_artifacts(brand_id: int, limit: int = 12, artifact_type: str | None = None) -> list[dict[str, Any]]:
    with db_connect() as conn:
        if artifact_type:
            rows = conn.execute(
                "SELECT * FROM artifacts WHERE brand_id = ? AND artifact_type = ? ORDER BY id DESC LIMIT ?",
                (brand_id, artifact_type, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM artifacts WHERE brand_id = ? ORDER BY id DESC LIMIT ?",
                (brand_id, limit),
            ).fetchall()
    return [serialize_artifact(row) for row in rows]


def overview_todos(summary: dict[str, Any], artifacts: list[dict[str, Any]]) -> list[dict[str, str]]:
    artifact_types = {item.get("artifact_type") for item in artifacts}
    todos: list[dict[str, str]] = []
    if summary["data_sources_count"] == 0:
        todos.append({"level": "attention", "text": "尚未匯入資料來源，請先新增品牌資料。", "href": "/data-hub"})
    if summary["data_sources_count"] and summary["extracted_count"] < summary["data_sources_count"]:
        todos.append({"level": "attention", "text": "部分資料尚未完成擷取，請回資料中心處理。", "href": "/data-hub"})
    if summary["extracted_count"] and summary["analyses_count"] < summary["extracted_count"]:
        todos.append({"level": "attention", "text": "部分資料尚未完成 AI 分析。", "href": "/data-hub"})
    if not summary["brand_dna_configured"]:
        todos.append({"level": "urgent", "text": "尚未建立品牌角色，請先完成診斷。", "href": "/diagnosis"})
    if summary["brand_dna_configured"] and "diagnosis_insight" not in artifact_types:
        todos.append({"level": "info", "text": "可以更新品牌角色診斷。", "href": "/diagnosis"})
    if summary["brand_dna_configured"] and "content_generation" not in artifact_types:
        todos.append({"level": "info", "text": "可以產生第一組品牌內容。", "href": "/generate"})
    if not todos:
        todos.append({"level": "success", "text": "目前資料與分析狀態正常。", "href": "/diagnosis"})
    return todos


def clamp_score(value: Any, fallback: int = 0) -> int:
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        return fallback


def normalize_diagnosis_insight(result: dict[str, Any], summary: dict[str, Any], analyses: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    if not isinstance(result, dict):
        result = {}
    dna = normalize_brand_dna_payload(summary.get("brand_dna") or {}) if summary.get("brand_dna") else {}
    primary = dna.get("brand_archetype") or primary_archetype_payload(dna)
    character = dna.get("brand_character") or brand_character_payload(dna, primary)
    archetype_result = result.get("archetype_position") if isinstance(result.get("archetype_position"), dict) else {}
    source_evidence = source_archetype_evidence_from_analyses(analyses or [])
    dimensions = build_archetype_dimensions(dna, archetype_result.get("dimensions"), source_evidence)
    character_result = result.get("character") if isinstance(result.get("character"), dict) else {}
    character_payload = {
        "name": character_result.get("name") or character.get("name"),
        "archetype": character_result.get("archetype") or primary.get("role_name"),
        "positioning": character_result.get("positioning") or character.get("positioning"),
        "traits": character_result.get("traits") or character.get("traits") or [],
        "voice": character_result.get("voice") or character.get("voice"),
        "visual_personality": character_result.get("visual_personality") or character.get("visual_personality"),
        "target_audience": character_result.get("target_audience") or character.get("target_audience"),
        "description": character_result.get("description") or character.get("description"),
        "visual_prompt": character_result.get("visual_prompt") or character.get("visual_prompt", ""),
        "style_tags": character_result.get("style_tags") or character.get("traits") or dna.get("keywords", [])[:5],
        "application_scenarios": character_result.get("application_scenarios")
        or [
            f"文案語氣：{character.get('voice', '')}",
            f"圖片方向：{character.get('visual_personality', '')}",
            f"核心客群：{character.get('target_audience', '')}",
        ],
    }
    normalized = {
        "global_scan": {
            "total_sources": summary["data_sources_count"],
            "extracted_count": summary["extracted_count"],
            "analyzed_count": summary["analyses_count"],
            "readiness_score": clamp_score(
                result.get("global_scan", {}).get("readiness_score")
                if isinstance(result.get("global_scan"), dict)
                else None,
                0 if not summary["data_sources_count"] else round(summary["analyses_count"] / max(summary["data_sources_count"], 1) * 100),
            ),
            "notes": (result.get("global_scan", {}) or {}).get("notes", []) if isinstance(result.get("global_scan"), dict) else [],
        },
        "archetype_position": {
            "primary_archetype": archetype_result.get("primary_archetype") or primary.get("role_name", "尚未定位"),
            "confidence": clamp_score(archetype_result.get("confidence"), 0),
            "dimensions": dimensions,
            "rationale": archetype_result.get("rationale") or primary.get("rationale", ""),
        },
        "brand_positioning": result.get("brand_positioning") or character.get("positioning") or dna.get("positioning", ""),
        "brand_traits": result.get("brand_traits") if isinstance(result.get("brand_traits"), list) else character.get("traits", []),
        "brand_voice": result.get("brand_voice") or character.get("voice", ""),
        "target_audience": result.get("target_audience") or character.get("target_audience", ""),
        "character": character_payload,
        "generation_settings": result.get("generation_settings") if isinstance(result.get("generation_settings"), dict) else {
            "copy_tone": character.get("voice", ""),
            "image_direction": character.get("visual_personality", ""),
            "audience": character.get("target_audience", ""),
        },
    }
    normalized["archetype_position"]["confidence"] = normalized["archetype_position"]["confidence"] or primary.get("confidence", 80)
    return normalized


CONTENT_PLATFORM_LABELS = {
    "instagram": "Instagram",
    "instagram_post": "Instagram",
    "ig": "Instagram",
    "facebook": "Facebook",
    "facebook_post": "Facebook",
    "fb": "Facebook",
}


def normalize_content_platform(value: Any) -> str | None:
    raw = str(value or "instagram").strip().lower()
    if raw in CONTENT_PLATFORM_LABELS:
        return "instagram" if CONTENT_PLATFORM_LABELS[raw] == "Instagram" else "facebook"
    return None


def fallback_marketing_suggestions(brand: dict[str, Any], brand_dna: dict[str, Any]) -> list[dict[str, str]]:
    brand_dna = normalize_brand_dna_payload(brand_dna or {})
    character = brand_dna.get("brand_character") or brand_character_payload(brand_dna)
    category = clean_display_text(brand.get("category") or DEFAULT_BRAND.get("category"), max_length=60) or "餐飲品牌"
    audience = clean_display_text(character.get("target_audience"), max_length=80) or "主要客群"
    traits = character.get("traits") or brand_dna.get("keywords") or []
    trait_text = "、".join(str(item).strip() for item in traits[:3] if str(item).strip()) or "品牌特色"
    return [
        {
            "label": "招牌品項情境貼文",
            "text": f"請幫我寫一則適合 Instagram 的{category}招牌品項情境貼文，主打{trait_text}，讓{audience}看了想收藏或到店。",
        },
        {
            "label": "尖峰時段外帶提醒",
            "text": f"請幫我寫一則尖峰時段外帶或預訂提醒貼文，語氣符合品牌角色，讓{audience}清楚知道可以先安排用餐。",
        },
        {
            "label": "熟客日常互動文",
            "text": f"請幫我寫一則日常互動型社群貼文，延續{category}的店家個性，邀請熟客分享最近最常點的餐點。",
        },
    ]


def normalize_marketing_suggestion_result(result: Any, brand: dict[str, Any], brand_dna: dict[str, Any]) -> list[dict[str, str]]:
    fallback = fallback_marketing_suggestions(brand, brand_dna)
    raw_items: Any = []
    if isinstance(result, dict):
        raw_items = result.get("suggestions") or result.get("items") or result.get("presets") or []
    elif isinstance(result, list):
        raw_items = result

    suggestions: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw_items if isinstance(raw_items, list) else []:
        if isinstance(item, dict):
            label = clean_display_text(item.get("label") or item.get("title"), max_length=24)
            text = clean_display_text(item.get("text") or item.get("request") or item.get("prompt"), max_length=220)
        else:
            label = clean_display_text(item, max_length=24)
            text = clean_display_text(item, max_length=220)
        if not text:
            continue
        if not label:
            label = text[:18]
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        suggestions.append({"label": label, "text": text})
        if len(suggestions) == 3:
            break

    for item in fallback:
        if len(suggestions) == 3:
            break
        if item["text"].lower() in seen:
            continue
        suggestions.append(item)
        seen.add(item["text"].lower())
    return suggestions[:3]


def compliance_settings_from_payload(payload: dict[str, Any], brand_dna: dict[str, Any]) -> dict[str, Any]:
    forbidden_words = []
    for source in [brand_dna.get("forbidden_words"), payload.get("forbidden_words")]:
        if isinstance(source, list):
            forbidden_words.extend(str(item).strip() for item in source if str(item).strip())
        elif isinstance(source, str) and source.strip():
            forbidden_words.extend(item.strip() for item in source.splitlines() if item.strip())
    return {
        "legal_rules": payload.get("legal_rules") or payload.get("selected_rules") or [],
        "forbidden_words": sorted(set(forbidden_words)),
        "internal_rules": payload.get("internal_rules") or "",
        "marketing_rules": payload.get("marketing_rules") or "",
        "custom_rules": payload.get("custom_rules") or [],
    }


def social_post_concept_image_prompt(
    *,
    platform: str,
    context: str,
    final_caption: str,
    brand_dna: dict[str, Any],
    character: dict[str, Any],
    compliance: dict[str, Any],
    model_image_prompt: str = "",
) -> str:
    platform_label = "Instagram" if platform == "instagram" else "Facebook"
    forbidden_words = compliance.get("forbidden_words") or []
    visual_direction = character.get("visual_personality") or brand_dna.get("visual_personality") or character.get("visual_prompt") or ""
    traits = character.get("traits") or brand_dna.get("brand_traits") or brand_dna.get("keywords") or []
    prompt_parts = [
        "Create one square, photorealistic, text-free social post concept image for a Taiwanese restaurant brand.",
        f"Platform: {platform_label}.",
        f"Marketing request/theme: {context.strip()}",
        f"Final caption this image must support: {final_caption.strip()}",
        f"Brand character: {character.get('name', '')}; positioning: {character.get('positioning', '')}; voice: {character.get('voice', '')}; target audience: {character.get('target_audience', '')}.",
        f"Brand traits: {', '.join(str(item) for item in traits if str(item).strip())}.",
        f"Visual direction: {visual_direction}.",
    ]
    if model_image_prompt:
        prompt_parts.append(f"Creative direction from copy generation: {model_image_prompt.strip()}")
    if forbidden_words:
        prompt_parts.append(f"Do not depict or imply these forbidden claims/terms: {', '.join(str(item) for item in forbidden_words)}.")
    prompt_parts.extend(
        [
            "Show clear food, ingredients, serving context, and warm breakfast-shop atmosphere that directly match the request and caption.",
            "No readable text, captions, menus, signage, labels, logos, brand marks, real people, celebrities, copyrighted characters, medical claims, legal claims, or exaggerated promises.",
            "Prioritize appetizing food styling, natural daylight, clean table setting, and a composition suitable for a finished social feed image.",
        ]
    )
    return "\n".join(part for part in prompt_parts if part and part.strip())


def normalize_content_generation_result(
    result: dict[str, Any],
    platform: str,
    brand_dna: dict[str, Any],
    compliance: dict[str, Any],
    context: str = "",
) -> dict[str, Any]:
    if not isinstance(result, dict):
        result = {}
    character = brand_dna.get("brand_character") or brand_character_payload(brand_dna)
    generated = result.get("generated_content")
    final_caption = result.get("final_caption")
    if not isinstance(generated, list):
        generated = [final_caption] if final_caption else []
    generated = [str(item).strip() for item in generated if str(item).strip()]
    if final_caption and final_caption not in generated:
        generated.insert(0, str(final_caption).strip())
    normalized = dict(result)
    normalized["platform"] = "Instagram" if platform == "instagram" else "Facebook"
    normalized["final_caption"] = generated[0] if generated else ""
    normalized["generated_content"] = generated
    normalized["brand_character"] = character
    normalized["target_audience"] = character.get("target_audience", "")
    normalized["compliance_settings"] = compliance
    normalized["image_prompt"] = social_post_concept_image_prompt(
        platform=platform,
        context=context,
        final_caption=normalized["final_caption"],
        brand_dna=brand_dna,
        character=character,
        compliance=compliance,
        model_image_prompt=str(result.get("image_prompt") or "").strip(),
    )
    normalized.setdefault("compliance_notes", ["已依規範設定生成最終版本。"])
    return normalized


def normalize_market_prediction_result(result: dict[str, Any], audiences: list[str]) -> dict[str, Any]:
    if not isinstance(result, dict):
        result = {}
    rows = result.get("audience_predictions") or result.get("persona_results") or []
    normalized_rows = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        name = row.get("audience") or row.get("persona") or row.get("segment") or "目標客群"
        score = clamp_score(row.get("acceptance_score") or row.get("score"), 75)
        normalized_rows.append(
            {
                "audience": str(name),
                "acceptance_score": score,
                "attraction_reason": row.get("attraction_reason") or row.get("reaction") or "對內容主題與品牌語氣有正向接受度。",
                "positive_response": row.get("positive_response") or row.get("reaction") or "可能願意留意貼文並進一步互動。",
            }
        )
    if not normalized_rows:
        normalized_rows = [
            {
                "audience": audience,
                "acceptance_score": 75,
                "attraction_reason": "符合此客群對品牌內容與社群資訊的期待。",
                "positive_response": "可能產生正向注意與互動意願。",
            }
            for audience in audiences
        ]
    top_segments = result.get("top_segments") if isinstance(result.get("top_segments"), list) else []
    if not top_segments:
        top_segments = [
            {"rank": index + 1, "audience": row["audience"], "reason": row["attraction_reason"]}
            for index, row in enumerate(sorted(normalized_rows, key=lambda item: item["acceptance_score"], reverse=True)[:2])
        ]
    normalized_top = []
    for index, item in enumerate(top_segments[:2]):
        if isinstance(item, dict):
            normalized_top.append(
                {
                    "rank": int(item.get("rank") or index + 1),
                    "audience": str(item.get("audience") or item.get("segment") or item.get("name") or ""),
                    "reason": str(item.get("reason") or item.get("attraction_reason") or ""),
                }
            )
        else:
            normalized_top.append({"rank": index + 1, "audience": str(item), "reason": ""})
    return {
        "overall_score": clamp_score(result.get("overall_score"), round(sum(row["acceptance_score"] for row in normalized_rows) / max(len(normalized_rows), 1))),
        "audience_predictions": normalized_rows,
        "top_segments": normalized_top,
    }


@app.route("/")
def index():
    return render_template("overview.html")


@app.route("/diagnosis")
def diagnosis():
    return render_template("diagnosis.html")


@app.route("/data-hub")
def data_hub():
    return render_template("data_hub.html")


@app.route("/generate")
def generate():
    return render_template("generate.html")


@app.route("/gatekeeper")
def gatekeeper():
    return render_template("gatekeeper.html")


@app.route("/simulation")
def simulation():
    return render_template("simulation.html")


@app.route("/artifacts/<path:filename>")
def artifact_file(filename: str):
    return send_from_directory(ARTIFACT_FOLDER.resolve(), filename)


@app.route("/api/brand", methods=["GET"])
def api_brand():
    with db_connect() as conn:
        row = conn.execute("SELECT * FROM brands WHERE id = ?", (default_brand_id(),)).fetchone()
    return api_success(brand=row_to_dict(row))


@app.route("/api/subscription", methods=["GET", "POST"])
def api_subscription():
    if request.method == "GET":
        return api_success(subscription=subscription_payload())
    payload = request.get_json(silent=True) or {}
    plan = payload.get("plan")
    if normalize_plan(plan) not in PLAN_CONFIG:
        return api_error("Unknown plan.", 400)
    set_subscription_plan(plan)
    return api_success(subscription=subscription_payload())


@app.route("/api/overview", methods=["GET"])
def api_overview():
    brand_id = default_brand_id()
    with db_connect() as conn:
        brand_row = conn.execute("SELECT * FROM brands WHERE id = ?", (brand_id,)).fetchone()
        source_rows = conn.execute(
            "SELECT * FROM raw_sources WHERE brand_id = ? ORDER BY id DESC LIMIT 8",
            (brand_id,),
        ).fetchall()
    summary = dashboard_summary_payload(brand_id)
    artifacts = latest_artifacts(brand_id, 12)
    diagnosis_items = latest_artifacts(brand_id, 1, "diagnosis_insight")
    latest_diagnosis = diagnosis_items[0] if diagnosis_items else None
    if latest_diagnosis:
        latest_diagnosis["payload"] = normalize_diagnosis_insight(
            latest_diagnosis.get("payload") or {},
            summary,
            latest_analyzed_source_payloads(brand_id),
        )
    return api_success(
        brand=row_to_dict(brand_row),
        summary=summary,
        subscription=subscription_payload(brand_id),
        sources=[serialize_source(row_to_dict(row) or {}) for row in source_rows],
        recent_artifacts=artifacts,
        latest_diagnosis=latest_diagnosis,
        todos=overview_todos(summary, artifacts),
    )


@app.route("/api/demo/import", methods=["POST"])
@app.route("/api/case/import", methods=["POST"])
def api_demo_import():
    brand_id = default_brand_id()
    with db_connect() as conn:
        brand_row = conn.execute("SELECT * FROM brands WHERE id = ?", (brand_id,)).fetchone()
    brand = row_to_dict(brand_row) or DEFAULT_BRAND
    demo_files = {
        "website": "官網 / 品牌頁資料",
        "facebook": "Facebook 貼文與公告",
        "google_reviews": "Google 評論 / 顧客回饋",
        "recruitment": "招募資訊摘要",
    }
    imported = []
    skipped = []
    raw_folder = RAWDATA_FOLDER / "demo_import"
    raw_folder.mkdir(parents=True, exist_ok=True)
    for source_type, title in demo_files.items():
        source_file = DEMO_DATA_FOLDER / f"{source_type}.json"
        if not source_file.exists():
            skipped.append({"source_type": source_type, "reason": "missing file"})
            continue
        with db_connect() as conn:
            rows = conn.execute(
                "SELECT metadata_json FROM raw_sources WHERE brand_id = ? AND source_type = ?",
                (brand_id, source_type),
            ).fetchall()
        if any(parse_json_field(row["metadata_json"], {}).get("source_file") == source_file.name for row in rows):
            skipped.append({"source_type": source_type, "reason": "already imported"})
            continue
        raw = json.loads(source_file.read_text(encoding="utf-8"))
        content = raw.get("content") if isinstance(raw, dict) else json.dumps(raw, ensure_ascii=False, indent=2)
        path = unique_file_path(raw_folder, f"{source_type}.txt")
        path.write_text(content or "", encoding="utf-8")
        source_id = insert_raw_source(
            brand_id,
            source_type,
            "text",
            title,
            original_filename=source_file.name,
            raw_path=safe_relative_path(path),
            mime_type="text/plain",
            metadata={"demo_import": True, "source_file": source_file.name},
        )
        imported.append({"id": source_id, "source_type": source_type, "title": title})
    return api_success(
        case_label=brand.get("name"),
        case_handle=brand.get("handle"),
        imported=imported,
        skipped=skipped,
    )


@app.route("/api/reset", methods=["POST"])
def api_reset_workspace():
    brand_id = default_brand_id()
    deleted = reset_brand_workspace(brand_id)
    return api_success(deleted=deleted, summary=dashboard_summary_payload(brand_id))


@app.route("/api/global-scan/run", methods=["POST"])
def api_run_global_scan():
    brand_id = default_brand_id()
    try:
        if request.content_type and request.content_type.startswith("multipart/form-data"):
            source_specs, invalid_urls = collect_global_scan_sources_from_form(request.form, request.files)
            selected_rules = normalize_selected_rules(request.form.getlist("selected_rules"))
            internal_rules = str(request.form.get("internal_rules") or "").strip()
        else:
            payload = request.get_json(silent=True) or {}
            source_specs, invalid_urls = collect_global_scan_sources(payload)
            selected_rules = normalize_selected_rules(payload.get("selected_rules"))
            internal_rules = str(payload.get("internal_rules") or "").strip()
    except ValueError as exc:
        return api_error(str(exc), 400)
    if invalid_urls:
        return api_error("部分 URL 格式無效，請使用 http:// 或 https:// 開頭的完整網址。", 400, invalid_urls=invalid_urls)
    if len(source_specs) < 3:
        return api_error(
            "資料來源不足，請至少提供 3 種來源。",
            400,
            required_sources=3,
            provided_sources=len(source_specs),
            provided_url_sources=len([item for item in source_specs if item.get("input_kind") == "url"]),
        )

    input_payload = {
        "source_specs": source_specs,
        "selected_rules": selected_rules,
        "internal_rules": internal_rules,
    }
    job_id = create_job(brand_id, "global_scan", input_payload)
    try:
        result = run_global_scan_job(job_id, brand_id, input_payload)
        return api_success(job=fetch_job(job_id), result=result)
    except GlobalScanError as exc:
        return api_error(str(exc), exc.status_code, job=fetch_job(job_id))
    except Exception as exc:
        update_job(job_id, "error", error=str(exc), mark_finished=True)
        return api_error(str(exc), 500, job=fetch_job(job_id))


@app.route("/api/global-scan/social-preview", methods=["POST"])
def api_global_scan_social_preview():
    brand_id = default_brand_id()
    payload = request.get_json(silent=True) or {}
    source_type = str(payload.get("source_type") or "").strip()
    url = normalize_url(payload.get("url"))
    if source_type not in SOCIAL_POST_SOURCE_TYPES:
        return api_error("社群貼文預覽僅支援 Instagram 或 Facebook。", 400)
    if not url:
        return api_error("請輸入 http:// 或 https:// 開頭的有效網址。", 400)
    try:
        text, artifact_path, metadata = extract_url_with_playwright(
            {
                "id": 0,
                "brand_id": brand_id,
                "source_type": source_type,
                "url": url,
                "title": f"{source_type_label(source_type)} preview",
            }
        )
        posts = split_social_preview_posts(text, source_type, SOCIAL_POST_COUNT)
        if not posts:
            return api_error("自動擷取找不到可用貼文內容，請改用手動輸入。", 422)
        return api_success(
            source_type=source_type,
            url=url,
            posts=posts,
            artifact_path=artifact_path,
            metadata=metadata,
        )
    except Exception as exc:
        return api_error(str(exc), 422)


@app.route("/api/source-input/<source_type>/submit", methods=["POST"])
def api_submit_source_input(source_type: str):
    brand_id = default_brand_id()
    if source_type not in GLOBAL_SCAN_URL_SOURCE_TYPES:
        return api_error("銝?渡?鞈?靘?憿???, 404")
    try:
        spec, invalid = collect_single_source_spec_from_form(source_type, request.form, request.files)
    except ValueError as exc:
        return api_error(str(exc), 400)
    if invalid:
        return api_error("URL ?澆?銝迤蝣綽?隢蝙??http:// ??https:// ????渡雯???, 400, invalid_url=invalid")
    if not spec:
        return api_error("隢?憛怠神甇方???皞??批捆??, 400")
    try:
        result = process_single_source_spec(brand_id, spec)
        status_code = 200 if result["extraction"]["status"] == "extracted" else 422
        return api_result(status_code == 200, status_code, **result)
    except Exception as exc:
        return api_error(str(exc), 500)


@app.route("/api/sources", methods=["GET", "POST"])
def api_sources():
    brand_id = default_brand_id()
    if request.method == "GET":
        with db_connect() as conn:
            rows = conn.execute(
                "SELECT * FROM raw_sources WHERE brand_id = ? ORDER BY id DESC",
                (brand_id,),
            ).fetchall()
        return api_success(sources=[serialize_source(row_to_dict(row) or {}) for row in rows])

    try:
        if request.content_type and request.content_type.startswith("multipart/form-data"):
            form = request.form
            uploaded = request.files.get("file")
            source_type = form.get("source_type", "custom")
            title = form.get("title") or None
            content = form.get("content", "")
            url = form.get("url", "").strip() or None
            input_kind = form.get("input_kind") or ""
        else:
            payload = request.get_json(silent=True) or {}
            uploaded = None
            source_type = payload.get("source_type", "custom")
            title = payload.get("title") or None
            content = payload.get("content", "")
            url = (payload.get("url") or "").strip() or None
            input_kind = payload.get("input_kind") or ""

        raw_path = None
        original_filename = None
        mime_type = None
        metadata: dict[str, Any] = {}
        manual_social_payload = None

        if request.content_type and request.content_type.startswith("multipart/form-data"):
            manual_social_payload = build_manual_social_posts_payload(source_type, request.form, request.files)
            if manual_social_payload:
                content, social_metadata = manual_social_payload
                metadata.update(social_metadata)
                title = title or f"{source_type_label(source_type)} 手動貼文"

        if uploaded and uploaded.filename:
            original_filename = uploaded.filename
            suffix = Path(original_filename).suffix.lower()
            mime_type = uploaded.mimetype or mimetypes.guess_type(original_filename)[0]
            input_kind = "image" if suffix in IMAGE_EXTENSIONS else "file"
            path = unique_file_path(RAWDATA_FOLDER / "uploads", original_filename)
            uploaded.save(path)
            raw_path = safe_relative_path(path)
            title = title or original_filename
            if suffix not in SUPPORTED_EXTENSIONS:
                metadata["unsupported_extension"] = suffix
            if url:
                metadata["source_url"] = url
        elif content:
            input_kind = "text"
            title = title or f"{source_type_label(source_type)} 手動輸入"
            path = unique_file_path(RAWDATA_FOLDER / "text", f"{source_type}.txt")
            path.write_text(content, encoding="utf-8")
            raw_path = safe_relative_path(path)
            mime_type = "text/plain"
            if url:
                metadata["source_url"] = url
        elif url:
            input_kind = "url"
            title = title or url
        else:
            return api_error("請提供文字、檔案或 URL。", 400)

        source_id = insert_raw_source(
            brand_id,
            source_type,
            input_kind,
            title,
            url=url,
            original_filename=original_filename,
            raw_path=raw_path,
            mime_type=mime_type,
            metadata=metadata,
        )
        return api_success(source=serialize_source(fetch_source(source_id) or {}))
    except ValueError as exc:
        return api_error(str(exc), 400)
    except Exception as exc:
        return api_error(str(exc), 500)


@app.route("/api/sources/<int:source_id>/extract", methods=["POST"])
def api_extract_source(source_id: int):
    source = fetch_source(source_id)
    if not source:
        return api_error("找不到來源。", 404)
    job_id = create_job(source["brand_id"], "extract_source", {"source_id": source_id})
    result = run_extract_job(job_id, source_id)
    status_code = 200 if result["status"] == "extracted" else 422
    return api_result(result["status"] == "extracted", status_code, job=fetch_job(job_id), extraction=result)


@app.route("/api/sources/<int:source_id>/analyze", methods=["POST"])
def api_analyze_source(source_id: int):
    source = fetch_source(source_id)
    if not source:
        return api_error("找不到來源。", 404)
    job_id = create_job(source["brand_id"], "analyze_source", {"source_id": source_id})
    result = run_analyze_job(job_id, source_id)
    status_code = 200 if result["status"] == "analyzed" else 422
    return api_result(result["status"] == "analyzed", status_code, job=fetch_job(job_id), analysis=result)


@app.route("/api/sources/<int:source_id>/fallback", methods=["POST"])
def api_source_fallback(source_id: int):
    source = fetch_source(source_id)
    if not source:
        return api_error("Source not found.", 404)
    payload = request.get_json(silent=True) or {}
    content = str(payload.get("content") or "").strip()
    if not content:
        return api_error("Fallback content is required.", 400)
    title = str(payload.get("title") or "").strip() or f"{source.get('title') or source_type_label(source.get('source_type', 'custom'))} fallback"
    should_analyze = payload.get("analyze", True) is not False
    fallback_source_id = create_text_source(
        source["brand_id"],
        source.get("source_type") or "custom",
        title,
        content,
        url=source.get("url"),
        metadata={
            "manual_fallback": True,
            "fallback_for_source_id": source_id,
            "fallback_for_url": source.get("url"),
            "fallback_for_source_type": source.get("source_type"),
        },
    )
    extraction = extract_source_content(fallback_source_id)
    analysis = analyze_source_content(fallback_source_id) if should_analyze and extraction["status"] == "extracted" else None
    return api_success(
        source=serialize_source(fetch_source(fallback_source_id) or {}),
        extraction=extraction,
        analysis=analysis,
    )


@app.route("/api/pipeline/run", methods=["POST"])
def api_run_pipeline():
    brand_id = default_brand_id()
    payload = request.get_json(silent=True) or {}
    source_ids = payload.get("source_ids")
    if source_ids:
        source_ids = [int(sid) for sid in source_ids]
    job_id = create_job(brand_id, "brand_dna_pipeline", {"source_ids": source_ids or "all"})
    try:
        result = run_pipeline_job(job_id, brand_id, source_ids)
        return api_success(job=fetch_job(job_id), result=result)
    except Exception as exc:
        update_job(job_id, "error", error=str(exc), mark_finished=True)
        return api_error(str(exc), 500, job=fetch_job(job_id))


@app.route("/api/jobs", methods=["GET"])
def api_jobs():
    brand_id = default_brand_id()
    with db_connect() as conn:
        rows = conn.execute("SELECT * FROM jobs WHERE brand_id = ? ORDER BY id DESC LIMIT 30", (brand_id,)).fetchall()
    jobs = []
    for row in rows:
        job = row_to_dict(row) or {}
        job["input"] = parse_json_field(job.pop("input_json"), {})
        job["result"] = parse_json_field(job.pop("result_json"), None)
        jobs.append(job)
    return api_success(jobs=jobs)


@app.route("/api/jobs/<int:job_id>", methods=["GET"])
def api_job(job_id: int):
    job = fetch_job(job_id)
    if not job:
        return api_error("?曆???job", 404)
    return api_success(job=job)


@app.route("/api/logs", methods=["GET"])
def api_logs():
    brand_id = default_brand_id()
    logs = fetch_system_logs(
        brand_id=brand_id,
        level=request.args.get("level") or None,
        event_type=request.args.get("event_type") or None,
        limit=int(request.args.get("limit") or 100),
    )
    return api_success(logs=logs, log_file=safe_relative_path(SYSTEM_LOG_PATH))


@app.route("/api/jobs/<int:job_id>/logs", methods=["GET"])
def api_job_logs(job_id: int):
    if not fetch_job(job_id):
        return api_error("?????job", 404)
    logs = fetch_system_logs(
        job_id=job_id,
        level=request.args.get("level") or None,
        event_type=request.args.get("event_type") or None,
        limit=int(request.args.get("limit") or 100),
    )
    return api_success(logs=logs, log_file=safe_relative_path(SYSTEM_LOG_PATH))


@app.route("/api/sources/<int:source_id>/logs", methods=["GET"])
def api_source_logs(source_id: int):
    if not fetch_source(source_id):
        return api_error("?????謕??????", 404)
    logs = fetch_system_logs(
        source_id=source_id,
        level=request.args.get("level") or None,
        event_type=request.args.get("event_type") or None,
        limit=int(request.args.get("limit") or 100),
    )
    return api_success(logs=logs, log_file=safe_relative_path(SYSTEM_LOG_PATH))


@app.route("/api/brand-dna", methods=["GET", "POST"])
def api_brand_dna():
    brand_id = default_brand_id()
    if request.method == "GET":
        dna = active_brand_dna(brand_id)
        return api_success(configured=bool(dna), brand_dna=dna)
    payload = request.get_json(silent=True) or {}
    if not payload:
        return api_error("Brand DNA payload 銝?箇征", 400)
    snapshot_id = save_brand_dna_snapshot(brand_id, payload, manual_overrides={"legacy_post": True})
    return api_success(snapshot_id=snapshot_id, brand_dna=active_brand_dna(brand_id))


@app.route("/api/brand-dna/override", methods=["POST"])
def api_brand_dna_override():
    brand_id = default_brand_id()
    payload = request.get_json(silent=True) or {}
    current = active_brand_dna(brand_id) or {}
    overrides = payload.get("overrides", payload)
    merged = {k: v for k, v in current.items() if not k.startswith("_")}
    merged.update(overrides)
    snapshot_id = save_brand_dna_snapshot(brand_id, merged, manual_overrides=overrides)
    return api_success(snapshot_id=snapshot_id, brand_dna=active_brand_dna(brand_id))


@app.route("/api/diagnosis/insights", methods=["POST"])
def api_diagnosis_insights():
    brand_id = default_brand_id()
    try:
        dna = active_brand_dna(brand_id)
        if not dna:
            return api_error("撠撱箇???DNA嚗??鞈?銝剖?摰?鞈???銝血遣蝡??NA??, 400")
        summary = dashboard_summary_payload(brand_id)
        analyses = latest_analyzed_source_payloads(brand_id)
        if not analyses:
            return api_error("目前沒有可用的來源分析結果，請先整理並分析資料來源。", 400)

        prompt = f"""
You are building a live brand diagnosis dashboard for a Taiwanese restaurant brand.
Use only the supplied analyzed source data and brand data. Do not invent fixed demo numbers.
The diagnosis must focus on 12 Brand Archetypes and brand character creation.
Do not include market trends, content opportunities, benchmark analysis, competitor gaps, improvement priorities, or recommendations.
For archetype_position.dimensions, you may include key, name, explanation, and evidence.
The backend will use Brand data archetype_scores as the source of truth for score and rank.
For the top five archetypes by Brand data archetype_scores, dimensions MUST include:
- explanation: one concrete paragraph explaining how the brand text matches this archetype, what traits appear, and why the score level makes sense.
- evidence: 2-3 short source-specific signals using source type/title or observable brand facts.
Avoid generic statements such as "score entered the top five", "0-100 fit", or archetype definitions without brand evidence. Do not split the explanation into reason/score-logic sections.

Dashboard summary:
{json.dumps({k: v for k, v in summary.items() if k != "brand_dna"}, ensure_ascii=False)}

Brand data:
{json.dumps(dna, ensure_ascii=False)[:12000]}

Analyzed sources:
{json.dumps(analyses, ensure_ascii=False)[:24000]}

Return compact JSON in this shape:
{{
  "global_scan": {{
    "readiness_score": 0,
    "notes": ["..."]
  }},
  "archetype_position": {{
    "primary_archetype": "...",
    "confidence": 0,
    "dimensions": [{{"key": "caregiver", "name": "照顧者型品牌", "score": 0, "explanation": "...", "evidence": ["..."]}}],
    "rationale": "..."
  }},
  "brand_positioning": "...",
  "brand_traits": ["..."],
  "brand_voice": "...",
  "target_audience": "...",
  "character": {{
    "name": "小丑型品牌",
    "archetype": "小丑型品牌",
    "positioning": "...",
    "traits": ["..."],
    "voice": "...",
    "visual_personality": "...",
    "target_audience": "...",
    "description": "...",
    "visual_prompt": "...",
    "style_tags": ["..."],
    "application_scenarios": ["..."]
  }},
  "generation_settings": {{
    "copy_tone": "...",
    "image_direction": "...",
    "audience": "..."
  }}
}}
"""
        result = generate_openai_json(
            prompt,
            system_instruction=(
                "You are a rigorous brand role diagnostician. Produce evidence-grounded 12-archetype and brand-character insight. "
                "Every top-five archetype explanation must be one concise paragraph that connects concrete brand/source signals to the archetype's traits and score level. "
                "Never include market trends, benchmark analysis, competitor gaps, or improvement advice. "
                "Use Traditional Chinese for user-facing text."
            ),
            temperature=0.25,
            max_output_tokens=5000,
            task="diagnosis",
        )
        normalized = normalize_diagnosis_insight(result, summary, analyses)
        artifact_id = create_artifact(brand_id, "diagnosis_insight", "品牌角色診斷", normalized)
        record_usage_event("diagnosis_insight", metadata={"artifact_id": artifact_id})
        return api_success(insight=normalized, artifact_id=artifact_id, subscription=subscription_payload(brand_id))
    except FeatureAccessError as exc:
        return access_error_response(exc)
    except Exception as exc:
        return api_error(str(exc), 500)


@app.route("/api/generation-history", methods=["GET"])
def api_generation_history():
    brand_id = default_brand_id()
    with db_connect() as conn:
        rows = conn.execute(
            "SELECT * FROM artifacts WHERE brand_id = ? ORDER BY id DESC LIMIT 30",
            (brand_id,),
        ).fetchall()
    history = []
    for row in rows:
        item = row_to_dict(row) or {}
        payload = parse_json_field(item.get("payload_json"), {})
        file_url = payload.get("file_url") if isinstance(payload, dict) else None
        file_url = file_url or artifact_file_url(item.get("file_path"))
        history.append(
            {
                "id": item["id"],
                "filename": str(item["id"]),
                "timestamp": item["created_at"],
                "type": item["artifact_type"],
                "title": item.get("title"),
                "file_url": file_url,
                "summary": (
                    payload.get("final_caption")
                    or payload.get("personality_narrative")
                    or payload.get("summary")
                    or item.get("title")
                    or ""
                )[:120],
                "content_count": len(payload.get("generated_content", [])) if isinstance(payload, dict) else 0,
            }
        )
    return api_success(history=history)


@app.route("/api/generation-detail/<identifier>", methods=["GET"])
def api_generation_detail(identifier: str):
    if identifier.isdigit():
        with db_connect() as conn:
            row = conn.execute("SELECT * FROM artifacts WHERE id = ?", (int(identifier),)).fetchone()
        if not row:
            return api_error("?曆??唳?摰??Ｗ閮?", 404)
        item = row_to_dict(row) or {}
        item["payload"] = parse_json_field(item.pop("payload_json"), {})
        if isinstance(item["payload"], dict):
            item["file_url"] = item["payload"].get("file_url") or artifact_file_url(item.get("file_path"))
            if item["file_url"] and not item["payload"].get("file_url"):
                item["payload"]["file_url"] = item["file_url"]
            if item.get("artifact_type") == "content_generation":
                item["payload"] = enrich_content_payload_with_concept_image(
                    int(item.get("brand_id") or default_brand_id()),
                    int(item.get("id") or 0),
                    item["payload"],
                    persist=True,
                )
        return api_success(data=item)

    return api_error("?曆??唳?摰??Ｗ閮?", 404)


@app.route("/api/latest-generated-post", methods=["GET"])
def api_latest_generated_post():
    brand_id = default_brand_id()
    with db_connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM artifacts
            WHERE brand_id = ? AND artifact_type = ?
            ORDER BY id DESC LIMIT 1
            """,
            (brand_id, "content_generation"),
        ).fetchone()
    if not row:
        return api_success(generated=None, artifact_id=None)
    item = row_to_dict(row) or {}
    payload = parse_json_field(item.get("payload_json"), {})
    if isinstance(payload, dict):
        payload = enrich_content_payload_with_concept_image(
            brand_id,
            int(item.get("id") or 0),
            payload,
            persist=True,
        )
    return api_success(generated=payload, artifact_id=item.get("id"))


@app.route("/api/generate-personality-prompt", methods=["POST"])
def api_generate_personality_prompt():
    try:
        require_feature_access("brand_image", "brand_image")
        payload = request.get_json(silent=True) or {}
        brand_dna = payload.get("brand_dna") or active_brand_dna(default_brand_id())
        if not brand_dna:
            return api_error("撠撱箇???DNA嚗??鞈?銝剖?摰?鞈???銝血遣蝡??NA??, 400")
        prompt = f"""
Create a brand-consistent image generation prompt for a restaurant marketing visual.
Use the brand character, 12-archetype positioning, target audience, and compliance-sensitive brand data.

Brand data:
{brand_dna_prompt_block(brand_dna)}

Style: {payload.get('art_style', '')}
Color tone: {payload.get('color_tone', '')}
Scene elements: {payload.get('scene_elements', '')}

Return JSON:
{{
  "english_prompt": "...",
  "chinese_explanation": "...",
  "visual_keywords": ["..."]
}}
"""
        result = generate_openai_json(
            prompt,
            system_instruction=(
                "You write production-ready image prompts for restaurant marketing visuals. "
                "Keep prompts specific, brand-safe, and grounded in the supplied brand character."
            ),
            temperature=0.35,
            task="image_prompt",
        )
        artifact_id = create_artifact(default_brand_id(), "image_prompt", "圖片設定", result)
        record_usage_event("image_prompt", metadata={"artifact_id": artifact_id})
        return api_success(
            prompt=result.get("english_prompt"),
            explanation=result.get("chinese_explanation", ""),
            keywords=result.get("visual_keywords", []),
            result=result,
            artifact_id=artifact_id,
            subscription=subscription_payload(),
        )
    except FeatureAccessError as exc:
        return access_error_response(exc)
    except Exception as exc:
        return api_error(str(exc), 500)


@app.route("/api/generate-brand-image", methods=["POST"])
def api_generate_brand_image():
    try:
        require_feature_access("brand_image", "brand_image")
        payload = request.get_json(silent=True) or {}
        prompt = payload.get("prompt", "").strip()
        if not prompt:
            return api_error("隢??Ｙ???隡?嚗?????????, 400")
        client = require_openai_client("brand image generation")
        size = payload.get("size", "1024x1024")
        image_generation_input = f"""
Draw a brand-safe restaurant social post concept image from this prompt.

User prompt:
{prompt}

Rules:
- Keep the image suitable for public-facing restaurant marketing.
- Do not add unsupported medical, legal, or exaggerated claims.
- Do not include readable text, captions, menus, signage, labels, logos, brand marks, real people, celebrities, or copyrighted characters.
- Prioritize clear food/place/atmosphere details over decorative abstraction.
- Make the result feel like a square, photorealistic social feed image concept.
"""
        response = create_openai_response(
            client,
            add_openai_reasoning({
                "model": openai_model_for("brand_image"),
                "input": image_generation_input.strip(),
                "instructions": openai_instructions_for(
                    "brand_image",
                    "Use the hosted image_generation tool to generate one final image. Keep any internal prompt revision grounded in the user's prompt.",
                    json_output=False,
                ),
                "text": {"format": {"type": "text"}, "verbosity": openai_verbosity_for("brand_image")},
                "tools": [{"type": "image_generation", "size": size, "action": "generate"}],
                "tool_choice": {"type": "image_generation"},
                "store": False,
            }, "brand_image"),
        )
        image_base64 = next(
            (
                output.result
                for output in getattr(response, "output", []) or []
                if getattr(output, "type", None) == "image_generation_call" and getattr(output, "result", None)
            ),
            None,
        )
        image_bytes = base64.b64decode(image_base64) if image_base64 else None
        if not image_bytes:
            return api_error("????憭望?嚗?蝔??岫?矽?游?????, 500")
        filename = f"brand_image_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.png"
        path = ARTIFACT_FOLDER / filename
        path.write_bytes(image_bytes)
        image_url = f"data:image/png;base64,{base64.b64encode(image_bytes).decode('utf-8')}"
        file_url = f"/artifacts/{filename}"
        linked_content_artifact_id = payload.get("content_artifact_id")
        payload_out = {
            "model": openai_model_for("brand_image"),
            "prompt": prompt,
            "size": size,
            "image_path": safe_relative_path(path),
            "file_url": file_url,
        }
        if linked_content_artifact_id is not None:
            payload_out["content_artifact_id"] = linked_content_artifact_id
        artifact_id = create_artifact(default_brand_id(), "brand_image", "品牌圖片", payload_out, file_path=safe_relative_path(path))
        if linked_content_artifact_id is not None:
            try:
                content_artifact_id = int(linked_content_artifact_id)
            except (TypeError, ValueError):
                content_artifact_id = 0
            if content_artifact_id:
                with db_connect() as conn:
                    row = conn.execute(
                        "SELECT payload_json FROM artifacts WHERE id = ? AND artifact_type = ?",
                        (content_artifact_id, "content_generation"),
                    ).fetchone()
                if row:
                    content_payload = parse_json_field(row["payload_json"], {})
                    if isinstance(content_payload, dict):
                        content_payload["concept_image"] = {
                            "artifact_id": artifact_id,
                            "file_url": file_url,
                            "prompt": prompt,
                            "size": size,
                            "image_path": safe_relative_path(path),
                        }
                        update_artifact_payload(content_artifact_id, content_payload)
        record_usage_event("brand_image", metadata={"artifact_id": artifact_id})
        return api_success(
            image_url=image_url,
            file_url=file_url,
            model=openai_model_for("brand_image"),
            artifact_id=artifact_id,
            subscription=subscription_payload(),
        )
    except FeatureAccessError as exc:
        return access_error_response(exc)
    except Exception as exc:
        return api_error(str(exc), 500)


@app.route("/api/brand-character-image-prompt", methods=["POST"])
def api_brand_character_image_prompt():
    try:
        require_feature_access("brand_image")
        brand_id = default_brand_id()
        brand_dna = active_brand_dna(brand_id)
        if not brand_dna:
            return api_error("尚未建立 Brand DNA，請先建立品牌角色後再產生角色圖。", 400)
        prompt_input = brand_character_image_prompt_input(brand_dna)
        prompt = f"""
Create a production-ready English image generation prompt for one original brand ambassador character.
The image will be generated as a vertical full-body character portrait for a Taiwanese restaurant brand.
Use only the supplied Brand DNA. Do not invent source facts, real people, logos, brand marks, copyrighted characters, or readable text.

Brand character image inputs:
{json.dumps(prompt_input, ensure_ascii=False)}

Return JSON:
{{
  "english_prompt": "...",
  "prompt_preview_zh": "...",
  "used_inputs": {{}},
  "style_keywords": ["..."]
}}
"""
        result = generate_openai_json(
            prompt,
            system_instruction=(
                "You are a senior creative director for brand character design and image-generation prompting. "
                "Write one concise but complete English prompt for a full-body, 3/4-view, vertical brand ambassador character. "
                "The character must express the primary 12-archetype role, secondary top-five archetype influences, brand positioning, traits, voice, visual personality, and target audience. "
                "Specify clothing, posture, facial expression, props, color mood, and simple background. "
                "Require complete body visibility with no cropping. "
                "Do not request readable text, logos, real people, celebrities, copyrighted characters, medical claims, legal claims, or exaggerated promises. "
                "Use Traditional Chinese only for prompt_preview_zh."
            ),
            temperature=0.35,
            max_output_tokens=2500,
            task="image_prompt",
        )
        normalized = normalize_brand_character_image_prompt_result(result, prompt_input)
        payload_out = {
            "model": openai_model_for("image_prompt"),
            **normalized,
        }
        artifact_id = create_artifact(brand_id, "brand_character_image_prompt", "品牌角色圖提示詞", payload_out)
        return api_success(
            prompt=normalized["english_prompt"],
            prompt_preview_zh=normalized["prompt_preview_zh"],
            used_inputs=normalized["used_inputs"],
            style_keywords=normalized["style_keywords"],
            artifact_id=artifact_id,
            subscription=subscription_payload(brand_id),
        )
    except FeatureAccessError as exc:
        return access_error_response(exc)
    except Exception as exc:
        return api_error(str(exc), 500)


@app.route("/api/generate-brand-character-image", methods=["POST"])
def api_generate_brand_character_image():
    try:
        require_feature_access("brand_image", "brand_image")
        brand_id = default_brand_id()
        brand_dna = active_brand_dna(brand_id)
        if not brand_dna:
            return api_error("尚未建立 Brand DNA，請先建立品牌角色後再產生角色圖。", 400)
        payload = request.get_json(silent=True) or {}
        prompt = str(payload.get("prompt") or "").strip()
        if not prompt:
            return api_error("缺少角色圖 image prompt，請先產生提示詞。", 400)
        size = str(payload.get("size") or "1024x1536")
        quality = str(payload.get("quality") or "low")
        model = openai_model_for("character_image")
        client = require_openai_client("brand character image generation")
        image_bytes = generate_brand_character_image_bytes(
            client,
            prompt,
            size=size,
            quality=quality,
            model=model,
        )
        filename = f"brand_character_image_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.png"
        path = ARTIFACT_FOLDER / filename
        path.write_bytes(image_bytes)
        relative_path = safe_relative_path(path)
        file_url = f"/artifacts/{filename}"
        payload_out = {
            "model": model,
            "prompt": prompt,
            "size": size,
            "quality": quality,
            "image_path": relative_path,
            "file_url": file_url,
        }
        artifact_id = create_artifact(
            brand_id,
            "brand_character_image",
            "品牌角色圖",
            payload_out,
            file_path=relative_path,
        )
        image_info = {
            "artifact_id": artifact_id,
            "file_url": file_url,
            "prompt": prompt,
            "model": model,
            "size": size,
            "created_at": utc_now(),
        }
        snapshot_id = write_character_image_to_brand_dna(brand_id, brand_dna, image_info)
        record_usage_event("brand_image", metadata={"artifact_id": artifact_id, "snapshot_id": snapshot_id, "kind": "brand_character_image"})
        image_url = f"data:image/png;base64,{base64.b64encode(image_bytes).decode('utf-8')}"
        return api_success(
            image_url=image_url,
            file_url=file_url,
            character_image=image_info,
            snapshot_id=snapshot_id,
            model=model,
            artifact_id=artifact_id,
            subscription=subscription_payload(brand_id),
        )
    except FeatureAccessError as exc:
        return access_error_response(exc)
    except Exception as exc:
        return api_error(str(exc), 500)


@app.route("/api/generate-content", methods=["POST"])
def api_generate_content():
    try:
        require_feature_access("generation", "content_generation")
        brand_dna = normalize_brand_dna_payload(get_or_error_brand_dna())
        payload = request.get_json(silent=True) or {}
        platform = normalize_content_platform(payload.get("content_type") or payload.get("platform") or "instagram")
        if not platform:
            return api_error("圖文生成只支援 Instagram 或 Facebook。", 400)
        context = payload.get("context", "")
        if not context.strip():
            return api_error("context is required.", 400)
        character = brand_dna.get("brand_character") or brand_character_payload(brand_dna)
        compliance = compliance_settings_from_payload(payload, brand_dna)
        prompt = f"""
Generate one final compliant, platform-native social post for a Taiwanese restaurant brand.
Only support Instagram or Facebook. The final output must already follow all compliance settings.
Use the brand character target audience as the primary audience; do not rely on a manually selected audience.
Return Traditional Chinese copy unless the requested context requires otherwise.

Platform writing rules:
- Instagram: shorter, more visual, more social, line breaks are welcome, natural emoji are allowed, ask or imply an easy interaction, include 3-6 relevant hashtags.
- Facebook: more complete and information-forward, suitable for announcements and regular customers, explain practical details clearly, use fewer hashtags and a natural closing.
- Both platforms: sound like a real social post, not an ad brief; keep the brand voice and avoid unsupported claims.

Image prompt rules:
- The image_prompt must be based on the Brand DNA, brand character, selected platform, request/context, final_caption, and compliance settings.
- It must describe one square, photorealistic, text-free social post concept image.
- It must show clear food/place/atmosphere details tied to the request and caption.
- It must avoid readable text, captions, menus, signage, labels, logos, brand marks, real people, celebrities, copyrighted characters, medical claims, legal claims, or exaggerated promises.

{brand_dna_prompt_block(brand_dna)}

Platform: {"Instagram" if platform == "instagram" else "Facebook"}
Brand character:
{json.dumps(character, ensure_ascii=False)}

Compliance settings:
{json.dumps(compliance, ensure_ascii=False)}

Request/context:
{context}

Return JSON:
{{
  "platform": "Instagram|Facebook",
  "final_caption": "...",
  "image_prompt": "...",
  "platform_strategy": "...",
  "tone_guide": {{
    "vocabulary": ["..."],
    "sentence_style": "...",
    "emoji_usage": "..."
  }},
  "generated_content": ["最終可使用文案"],
  "hashtags": ["..."],
  "compliance_notes": ["..."],
  "brand_fit_notes": ["..."],
  "target_audience": "..."
}}
"""
        result = generate_openai_json(
            prompt,
            system_instruction=(
                "You are a senior Taiwanese restaurant brand copywriter. "
                "Generate final IG/FB-ready Traditional Chinese copy that follows the brand character, target audience, and compliance rules. "
                "Make Instagram copy feel short, visual, interactive, and hashtag-ready; make Facebook copy clearer, more informational, and announcement-friendly. "
                "Also write a grounded image_prompt for a square, photorealistic, text-free social post concept image that uses the request, final caption, Brand DNA, platform, and compliance settings. "
                "Do not include intermediate planning sections."
            ),
            temperature=0.65,
            task="content_generation",
        )
        result = normalize_content_generation_result(result, platform, brand_dna, compliance, context=context)
        artifact_id = create_artifact(default_brand_id(), "content_generation", context[:40] or "社群貼文", result)
        record_usage_event("content_generation", metadata={"artifact_id": artifact_id})
        return api_success(generated=result, artifact_id=artifact_id, subscription=subscription_payload())
    except FeatureAccessError as exc:
        return access_error_response(exc)
    except Exception as exc:
        return api_error(str(exc), 500)


@app.route("/api/marketing-demand-suggestions", methods=["POST"])
def api_marketing_demand_suggestions():
    brand_id = default_brand_id()
    try:
        require_feature_access("generation")
        with db_connect() as conn:
            brand_row = conn.execute("SELECT * FROM brands WHERE id = ?", (brand_id,)).fetchone()
        brand = row_to_dict(brand_row) or DEFAULT_BRAND
        brand_dna = normalize_brand_dna_payload(active_brand_dna(brand_id) or {})
        analyses = latest_analyzed_source_payloads(brand_id, limit=6)
        prompt = f"""
Generate exactly three marketing request quick-button suggestions for the "行銷需求" input of a Taiwanese restaurant social-post generator.
The suggestions must be based on the store nature and Brand DNA, not generic placeholder buttons.
Each suggestion is a user request that will later be sent to an Instagram/Facebook copy generator.

Rules:
- Return exactly 3 suggestions.
- Use Traditional Chinese.
- label: short button text, 6-12 Chinese characters when possible.
- text: a complete marketing request sentence. It should mention the likely topic, platform-fit intent, and practical business moment.
- Suggestions should be distinct from each other: one can be product/menu focused, one timing/service focused, and one customer/community focused when appropriate.
- Do not write final social post copy or hashtags.
- Do not invent unsupported discounts, dates, prices, awards, health effects, or legal claims.

Brand:
{json.dumps(brand, ensure_ascii=False)}

Brand DNA:
{brand_dna_prompt_block(brand_dna) if brand_dna else "No Brand DNA snapshot is available. Use the brand category and description only."}

Recent analyzed source signals:
{json.dumps(analyses, ensure_ascii=False)[:9000]}

Return JSON:
{{
  "suggestions": [
    {{"label": "...", "text": "..."}},
    {{"label": "...", "text": "..."}},
    {{"label": "...", "text": "..."}}
  ]
}}
"""
        result = generate_openai_json(
            prompt,
            system_instruction=(
                "You are a practical Taiwanese restaurant marketing planner. "
                "Create exactly three concise quick-button marketing requests for a dashboard. "
                "Ground every option in the supplied brand and store type. Use Traditional Chinese only."
            ),
            temperature=0.55,
            max_output_tokens=900,
            task="marketing_suggestions",
        )
        suggestions = normalize_marketing_suggestion_result(result, brand, brand_dna)
        record_usage_event("marketing_suggestions", metadata={"suggestions": [item["label"] for item in suggestions]})
        return api_success(suggestions=suggestions, subscription=subscription_payload(brand_id))
    except FeatureAccessError as exc:
        return access_error_response(exc)
    except Exception as exc:
        return api_error(str(exc), 500)


@app.route("/api/risk-check", methods=["POST"])
def api_risk_check():
    try:
        require_feature_access("gatekeeper")
        payload = request.get_json(silent=True) or {}
        content = payload.get("content", "").strip()
        if not content:
            return api_error("content is required.", 400)
        custom_rules = payload.get("custom_rules") or []
        forbidden_words = payload.get("forbidden_words") or []
        brand_dna = active_brand_dna(default_brand_id()) or {}
        prompt = f"""
Check this marketing content for legal/compliance risk and brand-rule violations.
Return practical rewrite suggestions and a safe final version.

Content:
{content}

Brand data:
{brand_dna_prompt_block(brand_dna) if brand_dna else "No brand data available. Use general restaurant marketing standards."}

Custom rules:
{json.dumps(custom_rules, ensure_ascii=False)}

Forbidden or sensitive words:
{json.dumps(forbidden_words, ensure_ascii=False)}

Return JSON:
{{
  "is_compliant": true,
  "risk_level": "low|medium|high",
  "violations": [
    {{"issue": "...", "location": "...", "suggestion": "..."}}
  ],
  "safe_content": "...",
  "professional_rewrites": {{
    "rewritten_versions": [
      {{"version": "? 1", "content": "...", "explanation": "..."}}
    ]
  }}
}}
"""
        result = generate_openai_json(
            prompt,
            system_instruction=(
                "You are a conservative marketing compliance and brand-safety reviewer. "
                "Ground every issue in the supplied content, rules, or brand data. Use Traditional Chinese for user-facing text."
            ),
            temperature=0.15,
            task="risk_check",
        )
        artifact_id = create_artifact(
            default_brand_id(),
            "risk_check",
            "規範檢查",
            {"input": content, "custom_rules": custom_rules, "forbidden_words": forbidden_words, "result": result},
        )
        record_usage_event("risk_check", metadata={"artifact_id": artifact_id})
        return api_success(risk_analysis=result, artifact_id=artifact_id, subscription=subscription_payload())
    except FeatureAccessError as exc:
        return access_error_response(exc)
    except Exception as exc:
        return api_error(str(exc), 500)


@app.route("/api/simulate", methods=["POST"])
def api_simulate():
    try:
        require_feature_access("simulation")
        brand_dna = normalize_brand_dna_payload(get_or_error_brand_dna())
        payload = request.get_json(silent=True) or {}
        content = payload.get("content", "").strip()
        if not content:
            return api_error("content is required.", 400)
        audiences = payload.get("audiences") or payload.get("personas") or ["年輕上班族", "家庭客", "大學生", "社群追蹤者"]
        audiences = [str(item) for item in audiences if str(item).strip()]
        prompt = f"""
Run a market prediction for the supplied generated social post.
This is not a persona chat, interview, or role-play. Write concise market prediction summaries only.
Only output positive attraction reasons, likely positive response, acceptance score, and the top two target audiences.
Do not output concerns, negative reactions, risks, improvement suggestions, reaction distribution, or sentiment ratios.

Brand data:
{brand_dna_prompt_block(brand_dna)}

Generated social post:
{content}

Selected audiences:
{json.dumps(audiences, ensure_ascii=False)}

Return JSON:
{{
  "overall_score": 0,
  "audience_predictions": [
    {{
      "audience": "...",
      "acceptance_score": 0,
      "attraction_reason": "...",
      "positive_response": "..."
    }}
  ],
  "top_segments": [
    {{"rank": 1, "audience": "...", "reason": "..."}},
    {{"rank": 2, "audience": "...", "reason": "..."}}
  ]
}}
"""
        result = generate_openai_json(
            prompt,
            system_instruction=(
                "You are a market prediction analyst. Estimate positive audience acceptance as directional hypotheses, "
                "not factual survey results. Never include dialogue, concerns, risks, or improvement suggestions. "
                "Use Traditional Chinese for user-facing text."
            ),
            temperature=0.45,
            task="simulation",
        )
        result = normalize_market_prediction_result(result, audiences)
        artifact_id = create_artifact(default_brand_id(), "simulation", "市場預測", {"input": content, "audiences": audiences, "result": result})
        record_usage_event("simulation", metadata={"artifact_id": artifact_id})
        return api_success(simulation=result, artifact_id=artifact_id, subscription=subscription_payload())
    except FeatureAccessError as exc:
        return access_error_response(exc)
    except Exception as exc:
        return api_error(str(exc), 500)


init_db()


def main() -> None:
    import socket

    def is_port_in_use(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(("localhost", port)) == 0

    port = int(os.getenv("PORT", "5000"))
    if is_port_in_use(port):
        print(f"Port {port} is already in use, switching to {port + 1}.")
        port += 1

    print("=" * 60)
    print("BrandDNA Analytics Dashboard starting...")
    print(f"URL: http://127.0.0.1:{port}")
    print(f"DB: {DB_PATH}")
    print("=" * 60)
    app.run(debug=True, host="127.0.0.1", port=port, use_reloader=False)


if __name__ == "__main__":
    main()
