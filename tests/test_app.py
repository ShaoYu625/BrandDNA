import base64
import importlib
from io import BytesIO
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

VALID_PNG_BYTES = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC")


class BrandDnaAppTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        base = cls.tmp.name
        os.environ["RUNTIME_FOLDER"] = base
        os.environ["APP_DB_PATH"] = os.path.join(base, "data", "test.sqlite3")
        os.environ["DATA_FOLDER"] = os.path.join(base, "data")
        os.environ["DEMO_DATA_FOLDER"] = str(PROJECT_ROOT / "examples" / "demo_sources")
        os.environ["RAWDATA_FOLDER"] = os.path.join(base, "rawdata")
        os.environ["ARTIFACT_FOLDER"] = os.path.join(base, "artifacts")
        os.environ["UPLOAD_FOLDER"] = os.path.join(base, "uploads")
        cls.app_module = importlib.import_module("branddna.app")
        cls.client = cls.app_module.app.test_client()
        cls.original_generate_openai_json = cls.app_module.generate_openai_json
        cls.original_extract_url_with_playwright = cls.app_module.extract_url_with_playwright
        cls.original_openai_client = cls.app_module.openai_client
        cls.original_openai_models = dict(cls.app_module.OPENAI_MODELS)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self.app_module.generate_openai_json = self.original_generate_openai_json
        self.app_module.extract_url_with_playwright = self.original_extract_url_with_playwright
        self.app_module.openai_client = self.original_openai_client
        self.app_module.OPENAI_MODELS.clear()
        self.app_module.OPENAI_MODELS.update(self.original_openai_models)
        with self.app_module.db_connect() as conn:
            conn.execute("DELETE FROM usage_events")
            conn.execute("UPDATE subscription_state SET plan = 'AIR', updated_at = ? WHERE id = 1", (self.app_module.utc_now(),))

    def seed_brand_dna(self):
        return self.app_module.save_brand_dna_snapshot(
            self.app_module.default_brand_id(),
            {
                "brand_name": "沒事早事坐",
                "handle": "zao_shih",
                "archetype": "照顧者型品牌",
                "brand_archetype": {
                    "key": "caregiver",
                    "name_zh": "照顧者",
                    "name_en": "The Caregiver",
                    "role_name": "照顧者型品牌",
                    "confidence": 88,
                    "rationale": "重視日常照顧、親切服務與安心早餐體驗。",
                },
                "archetype_scores": {
                    "caregiver": 88,
                    "everyman": 82,
                    "creator": 55,
                },
                "brand_character": {
                    "name": "照顧者型品牌",
                    "positioning": "在地、溫暖、穩定的早午餐品牌。",
                    "traits": ["早餐", "親切", "在地"],
                    "voice": "溫暖親切",
                    "visual_personality": "明亮、乾淨、帶有手作早餐溫度",
                    "target_audience": "重視便利早餐與安心感的家庭客",
                    "description": "像熟悉鄰居一樣照顧每日早餐需求。",
                    "visual_prompt": "warm Taiwanese breakfast shop social image",
                },
                "personality_scores": {
                    "sincerity": 88,
                    "activity": 62,
                    "competence": 76,
                    "authenticity": 91,
                    "competitiveness": 70,
                },
                "keywords": ["早餐", "親切", "在地"],
                "forbidden_words": ["誇大療效"],
                "tone_guide": {"voice": "溫暖親切"},
                "audience_segments": [{"name": "家庭客", "need": "便利早餐", "message_angle": "溫暖陪伴"}],
                "content_guidelines": ["保持自然口吻"],
                "improvement_priorities": ["強化品牌記憶點"],
                "summary": "在地、溫暖、穩定的早午餐品牌。",
            },
        )

    def seed_analyzed_source(self):
        source_id = self.app_module.insert_raw_source(
            self.app_module.default_brand_id(),
            "google_reviews",
            "text",
            "Google reviews test source",
            mime_type="text/plain",
        )
        source = self.app_module.fetch_source(source_id)
        self.app_module.create_analysis_result(
            source,
            "analyzed",
            {
                "source_summary": "顧客回饋偏正向，重視餐點與服務。",
                "scores": {
                    "sincerity": {"score": 88, "reasoning": "親切"},
                    "activity": {"score": 62, "reasoning": "互動穩定"},
                    "competence": {"score": 76, "reasoning": "品質穩定"},
                    "authenticity": {"score": 91, "reasoning": "在地真實"},
                    "competitiveness": {"score": 70, "reasoning": "具差異化"},
                },
                "keywords": ["早餐", "服務"],
                "tone_markers": ["親切"],
                "risks_or_gaps": ["資訊可更完整"],
                "content_opportunities": ["介紹招牌餐點"],
            },
        )
        return source_id

    def test_archetype_dimensions_fill_sort_and_filter_reasoning(self):
        dna = self.app_module.normalize_brand_dna_payload(
            {
                "brand_archetype": {"key": "caregiver", "confidence": 88, "rationale": "親切服務與安心感明確。"},
                "archetype_scores": {"caregiver": 88, "everyman": 82, "creator": 55},
                "brand_character": {"positioning": "在地早餐", "voice": "溫暖親切"},
                "summary": "在地、溫暖、穩定的早午餐品牌。",
            }
        )
        dimensions = self.app_module.build_archetype_dimensions(
            dna,
            [
                {
                    "key": "caregiver",
                    "reason": "bad � text",
                    "score_logic": "AI 說明優先",
                    "evidence": ["來源線索", "bad � evidence"],
                }
            ],
        )

        self.assertEqual(len(dimensions), 12)
        self.assertEqual([row["key"] for row in dimensions[:3]], ["caregiver", "everyman", "creator"])
        self.assertEqual(sum(1 for row in dimensions if row["is_top_five"]), 5)
        self.assertEqual(sum(1 for row in dimensions if not row["is_top_five"]), 7)
        self.assertEqual(dimensions[0]["rank"], 1)
        self.assertNotIn("�", dimensions[0]["reason"])
        self.assertEqual(dimensions[0]["score_logic"], "AI 說明優先")
        self.assertEqual(dimensions[0]["evidence"], ["來源線索"])
        self.assertIn("來源線索", dimensions[0]["explanation"])
        self.assertTrue(dimensions[3]["reason"])
        self.assertIn("/100", dimensions[3]["score_logic"])
        self.assertIn("加分線索", dimensions[3]["score_logic"])
        self.assertTrue(dimensions[3]["explanation"])

    def test_archetype_dimensions_keep_stable_order_for_ties(self):
        dna = self.app_module.normalize_brand_dna_payload(
            {
                "brand_archetype": {"key": "hero", "confidence": 50},
                "archetype_scores": {"hero": 50, "innocent": 50},
            }
        )
        dimensions = self.app_module.build_archetype_dimensions(dna)

        self.assertEqual(dimensions[0]["key"], "innocent")
        self.assertEqual(dimensions[1]["key"], "hero")

    def test_source_archetype_evidence_filters_bad_text(self):
        evidence = self.app_module.source_archetype_evidence_from_analyses(
            [
                {
                    "title": "Google reviews",
                    "result": {
                        "archetype_signals": {
                            "scores": {
                                "everyman": {"score": 80, "reasoning": "日常感明確"},
                                "caregiver": {"score": 70, "reasoning": "bad � text"},
                            }
                        }
                    },
                }
            ]
        )

        self.assertEqual(evidence["everyman"], ["Google reviews：日常感明確"])
        self.assertEqual(evidence["caregiver"], [])

    def test_brand_endpoint_initializes_default_brand(self):
        response = self.client.get("/api/brand")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["brand"]["handle"], "zao_shih")

    def test_pages_render(self):
        for path in ["/", "/data-hub", "/diagnosis", "/generate", "/gatekeeper", "/simulation"]:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertIn(b"BrandDNA", response.data)
                if path == "/diagnosis":
                    html = response.data.decode("utf-8")
                    self.assertIn("renderArchetypeRanking", html)
                    self.assertIn("archetype-ranking-shell", html)
                    self.assertIn("其餘 7 個人格分數", html)
                    self.assertIn("人格說明", html)
                    self.assertIn("archetype-thumb", html)
                    self.assertIn("character-image-panel", html)
                    self.assertIn("character-workspace", html)
                    self.assertIn("compact-status-grid", html)
                    self.assertIn("generateCharacterImageBtn", html)
                    self.assertIn("characterPromptPreview", html)
                    self.assertNotIn('id="runPipelineBtn"', html)
                    self.assertNotIn('id="characterDetails"', html)
                    self.assertIn("/static/archetypes/everyman.svg", html)
                    self.assertIn("setArchetypeImage", html)
                if path == "/generate":
                    html = response.data.decode("utf-8")
                    self.assertNotIn('<label class="form-label fw-bold fine">輸出</label>', html)
                    self.assertNotIn("最終合規貼文", html)
                    self.assertIn('id="marketingPresetList"', html)
                    self.assertIn("loadMarketingPresetsIfEmpty", html)
                    self.assertIn("/api/marketing-demand-suggestions", html)
                    self.assertNotIn("蛋餅新口味上架", html)
                    self.assertNotIn("上班上課快速早餐組合", html)
                    self.assertNotIn("尖峰時段先電話預訂", html)
                    self.assertIn("fa-share-nodes", html)
                    self.assertNotIn("fab fa-instagram me-2\"></i>最終社群貼文", html)
                    self.assertIn("貼文圖片建議概念圖", html)
                    self.assertIn("生成整組貼文", html)
                    self.assertNotIn('id="generateImageBtn"', html)
                    self.assertIn('id="historyList"', html)
                    self.assertIn("產出紀錄", html)
                    self.assertNotIn("生成歷史", html)
                    self.assertIn("artifactImageUrl", html)
                    self.assertIn("restoreLatestGeneration", html)
                    self.assertIn("pairedImageRecordForContent", html)
                    self.assertIn("Older running Flask processes may not have this endpoint", html)
                    self.assertLess(html.index("用量"), html.index("quotaPanel"))
                    self.assertLess(html.index("quotaPanel"), html.index("產出狀態"))

    def test_all_archetype_images_exist(self):
        image_dir = self.app_module.PACKAGE_DIR / "static" / "archetypes"
        for key in self.app_module.BRAND_ARCHETYPES:
            with self.subTest(key=key):
                path = image_dir / f"{key}.svg"
                self.assertTrue(path.exists())
                text = path.read_text(encoding="utf-8")
                self.assertIn("<svg", text)
                self.assertIn("circle", text)

    def test_brand_character_image_prompt_requires_brand_dna(self):
        brand_id = self.app_module.default_brand_id()
        with self.app_module.db_connect() as conn:
            conn.execute("DELETE FROM brand_dna_snapshots WHERE brand_id = ?", (brand_id,))

        response = self.client.post("/api/brand-character-image-prompt")
        self.assertEqual(response.status_code, 400)

    def test_brand_character_image_prompt_uses_brand_dna_inputs(self):
        self.seed_brand_dna()

        def fake_json(prompt, system_instruction, **kwargs):
            self.assertIn("top_archetypes", prompt)
            self.assertIn("full-body", system_instruction)
            return {
                "english_prompt": "Full-body warm restaurant brand ambassador, 3/4 view, complete body visible.",
                "prompt_preview_zh": "以照顧者原型與早餐品牌定位生成完整角色圖。",
                "used_inputs": {"primary_archetype": "caregiver"},
                "style_keywords": ["full-body", "warm", "restaurant"],
            }

        self.app_module.generate_openai_json = fake_json
        response = self.client.post("/api/brand-character-image-prompt")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn("Full-body", data["prompt"])
        self.assertEqual(data["style_keywords"][0], "full-body")
        self.assertIn("artifact_id", data)

    def test_generate_brand_character_image_saves_artifact_and_brand_dna(self):
        self.seed_brand_dna()
        calls = []

        class FakeImages:
            def generate(self, **kwargs):
                calls.append(kwargs)
                return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(VALID_PNG_BYTES).decode("utf-8"))])

        self.app_module.openai_client = SimpleNamespace(images=FakeImages())
        self.app_module.OPENAI_MODELS["character_image"] = "gpt-image-2"
        response = self.client.post(
            "/api/generate-brand-character-image",
            json={"prompt": "Full-body brand ambassador character.", "size": "1024x1536"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(calls[0]["model"], "gpt-image-2")
        self.assertEqual(calls[0]["size"], "1024x1536")
        self.assertEqual(calls[0]["quality"], "low")
        self.assertIn("artifact_id", data)

        dna = self.app_module.active_brand_dna()
        image = dna["brand_character"]["character_image"]
        self.assertEqual(image["artifact_id"], data["artifact_id"])
        self.assertEqual(image["file_url"], data["file_url"])
        self.assertEqual(image["size"], "1024x1536")

        overview = self.client.get("/api/overview").get_json()
        overview_image = overview["summary"]["brand_dna"]["brand_character"]["character_image"]
        self.assertEqual(overview_image["artifact_id"], data["artifact_id"])
        usage = self.app_module.weekly_usage_counts()
        self.assertEqual(usage.get("brand_image"), 1)

        artifact_response = self.client.get(data["file_url"])
        self.assertEqual(artifact_response.status_code, 200)
        self.assertEqual(artifact_response.data, VALID_PNG_BYTES)

    def test_main_navigation_uses_new_product_flow(self):
        response = self.client.get("/")
        html = response.data.decode("utf-8")
        self.assertIn("資料中心", html)
        self.assertIn("品牌診斷／品牌角色", html)
        self.assertIn("圖文生成", html)
        self.assertIn("市場預測", html)
        self.assertNotIn("規範守門員</span>", html)
        self.assertNotIn("市場模擬", html)

    def test_data_hub_hides_raw_text_entry_but_keeps_extracted_text(self):
        self.client.post("/api/reset")
        source_id = self.app_module.create_text_source(
            self.app_module.default_brand_id(),
            "website",
            "Raw text source",
            "Raw extracted content stays available for downstream analysis.",
        )
        source = self.app_module.fetch_source(source_id)
        self.app_module.create_extraction_result(source, "extracted", "Raw extracted content stays available.")

        page = self.client.get("/data-hub")
        html = page.data.decode("utf-8")
        self.assertNotIn("原文", html)
        self.assertNotIn("sourceRaw", html)

        data = self.client.get("/api/sources").get_json()
        created = next(item for item in data["sources"] if item["id"] == source_id)
        self.assertEqual(created["latest_extraction"]["extracted_text"], "Raw extracted content stays available.")

    def test_reset_button_renders_on_entry_pages(self):
        for path in ["/", "/data-hub"]:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertIn(b"data-reset-workspace", response.data)

    def test_openai_placeholder_key_is_treated_as_missing(self):
        self.assertIsNone(self.app_module.normalize_openai_api_key("your_openai_api_key"))
        self.assertIsNone(self.app_module.normalize_openai_api_key(" your-api-key "))
        self.assertEqual(self.app_module.normalize_openai_api_key("sk-test-real-looking-key"), "sk-test-real-looking-key")

    def test_dotenv_file_overrides_stale_environment_key(self):
        self.assertNotEqual(self.app_module.raw_openai_api_key, "your_openai_api_key")

    def test_openai_auth_error_is_user_safe(self):
        error = self.app_module.user_safe_openai_error(
            RuntimeError(
                "Error code: 401 - {'error': {'message': 'Incorrect API key provided: sk-proj-secret', 'code': 'invalid_api_key'}}"
            )
        )
        self.assertIsInstance(error, self.app_module.OpenAIConfigurationError)
        self.assertIn("OPENAI_API_KEY is invalid", str(error))
        self.assertNotIn("sk-proj-secret", str(error))

    def test_openai_response_retries_without_temperature_when_unsupported(self):
        class FakeResponse:
            output_text = '{"ok": true}'

        class FakeResponses:
            def __init__(self):
                self.calls = []

            def create(self, **kwargs):
                self.calls.append(kwargs)
                if len(self.calls) == 1:
                    raise RuntimeError("Unsupported parameter: 'temperature' is not supported with this model.")
                return FakeResponse()

        class FakeClient:
            def __init__(self):
                self.responses = FakeResponses()

        client = FakeClient()
        response = self.app_module.create_openai_response(client, {"model": "gpt-5.4-mini", "input": "test"}, temperature=0.2)
        self.assertEqual(response.output_text, '{"ok": true}')
        self.assertIn("temperature", client.responses.calls[0])
        self.assertNotIn("temperature", client.responses.calls[1])

    def test_openai_reasoning_none_omits_response_parameter(self):
        class FakeResponse:
            output_text = '{"ok": true}'

        class FakeResponses:
            def __init__(self):
                self.calls = []

            def create(self, **kwargs):
                self.calls.append(kwargs)
                return FakeResponse()

        class FakeClient:
            def __init__(self):
                self.responses = FakeResponses()

        original_client = self.app_module.openai_client
        original_reasoning = dict(self.app_module.OPENAI_REASONING_EFFORT)
        client = FakeClient()
        try:
            self.app_module.openai_client = client
            self.app_module.OPENAI_REASONING_EFFORT["source_analysis"] = "none"
            self.app_module.OPENAI_REASONING_EFFORT["brand_dna"] = "low"

            self.assertIsNone(self.app_module.openai_reasoning_for("source_analysis"))
            self.assertEqual(self.app_module.openai_reasoning_for("brand_dna"), {"effort": "low"})

            self.app_module.generate_openai_json("test", "system", task="source_analysis")
            self.app_module.generate_openai_json("test", "system", task="brand_dna")
        finally:
            self.app_module.openai_client = original_client
            self.app_module.OPENAI_REASONING_EFFORT.clear()
            self.app_module.OPENAI_REASONING_EFFORT.update(original_reasoning)

        self.assertNotIn("reasoning", client.responses.calls[0])
        self.assertEqual(client.responses.calls[1]["reasoning"], {"effort": "low"})

    def test_openai_usage_cost_uses_response_usage_and_cached_pricing(self):
        class FakeResponse:
            model = "gpt-5.4-mini"
            service_tier = "default"
            usage = {
                "input_tokens": 1000,
                "input_tokens_details": {"cached_tokens": 100},
                "output_tokens": 200,
                "output_tokens_details": {"reasoning_tokens": 50},
                "total_tokens": 1200,
            }

        usage = self.app_module.openai_usage_from_response(FakeResponse(), {"model": "gpt-5.4-mini"})
        self.assertEqual(usage["input_tokens"], 1000)
        self.assertEqual(usage["cached_input_tokens"], 100)
        self.assertEqual(usage["output_tokens"], 200)
        self.assertEqual(usage["reasoning_tokens"], 50)
        self.assertEqual(usage["total_tokens"], 1200)
        self.assertAlmostEqual(usage["cost_usd"], 0.0015825)

    def test_api_success_includes_current_request_openai_usage(self):
        class FakeResponse:
            output_text = '{"ok": true}'
            model = "gpt-5.4-mini"
            service_tier = "default"
            usage = {
                "input_tokens": 1000,
                "input_tokens_details": {"cached_tokens": 100},
                "output_tokens": 200,
                "output_tokens_details": {"reasoning_tokens": 50},
                "total_tokens": 1200,
            }

        class FakeResponses:
            def create(self, **_kwargs):
                return FakeResponse()

        class FakeClient:
            responses = FakeResponses()

        with self.app_module.app.test_request_context("/api/test"):
            self.app_module.create_openai_response(FakeClient(), {"model": "gpt-5.4-mini", "input": "test"})
            response = self.app_module.api_success(ok=True)
            data = response.get_json()

        self.assertEqual(data["ai_usage"]["calls"], 1)
        self.assertEqual(data["ai_usage"]["input_tokens"], 1000)
        self.assertEqual(data["ai_usage"]["cached_input_tokens"], 100)
        self.assertEqual(data["ai_usage"]["output_tokens"], 200)
        self.assertEqual(data["ai_usage"]["total_tokens"], 1200)
        self.assertAlmostEqual(data["ai_usage"]["cost_usd"], 0.0015825)

    def test_source_analyze_response_includes_current_request_openai_usage(self):
        source_id = self.app_module.create_text_source(
            self.app_module.default_brand_id(),
            "custom",
            "Token usage source",
            "This source contains enough restaurant brand evidence to run source analysis.",
        )

        def fake_json(*_args, **_kwargs):
            if not hasattr(self.app_module.g, "openai_usage_events"):
                self.app_module.g.openai_usage_events = []
            self.app_module.g.openai_usage_events.append(
                {
                    "model": "gpt-5.4-mini",
                    "input_tokens": 321,
                    "cached_input_tokens": 0,
                    "output_tokens": 45,
                    "reasoning_tokens": 7,
                    "total_tokens": 366,
                    "cost_usd": 0.0005,
                }
            )
            return {
                "source_summary": "在地餐飲品牌資料。",
                "archetype_signals": {"primary": "caregiver", "secondary": [], "scores": {}},
                "brand_role_evidence": {
                    "positioning": ["在地"],
                    "traits": ["親切"],
                    "voice": ["溫暖"],
                    "visual_personality": ["明亮"],
                    "target_audience": ["家庭客"],
                },
                "keywords": ["早餐"],
                "tone_markers": ["親切"],
                "visual_evidence": [],
                "risks_or_gaps": [],
                "content_opportunities": [],
            }

        self.app_module.generate_openai_json = fake_json
        response = self.client.post(f"/api/sources/{source_id}/analyze")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["ai_usage"]["calls"], 1)
        self.assertEqual(data["ai_usage"]["total_tokens"], 366)
        self.assertEqual(data["ai_usage"]["input_tokens"], 321)
        self.assertEqual(data["ai_usage"]["output_tokens"], 45)
        self.assertAlmostEqual(data["ai_usage"]["cost_usd"], 0.0005)

    def test_analyze_source_returns_422_when_ai_raises(self):
        self.client.post("/api/reset")
        source_id = self.app_module.create_text_source(
            self.app_module.default_brand_id(),
            "website",
            "AI failure source",
            "This source text is long enough to trigger analysis.",
        )

        def fail_json(*args, **kwargs):
            raise RuntimeError("AI unavailable")

        self.app_module.generate_openai_json = fail_json
        response = self.client.post(f"/api/sources/{source_id}/analyze")
        self.assertEqual(response.status_code, 422)
        data = response.get_json()
        self.assertFalse(data["success"])
        self.assertEqual(data["analysis"]["status"], "error")
        self.assertEqual(data["job"]["status"], "error")

    def test_subscription_switch_and_free_feature_blocks(self):
        response = self.client.get("/api/subscription")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["subscription"]["plan"], "AIR")

        switched = self.client.post("/api/subscription", json={"plan": "FREE"})
        self.assertEqual(switched.status_code, 200)
        self.assertEqual(switched.get_json()["subscription"]["plan"], "FREE")

        blocked = self.client.post("/api/risk-check", json={"content": "test"})
        self.assertEqual(blocked.status_code, 403)
        self.assertFalse(blocked.get_json()["success"])

        sim_blocked = self.client.post("/api/simulate", json={"content": "test"})
        self.assertEqual(sim_blocked.status_code, 403)

    def test_free_content_quota_records_and_blocks(self):
        self.seed_brand_dna()

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            return {
                "personality_narrative": "fit",
                "tone_guide": {"vocabulary": ["早餐"]},
                "generated_content": ["早餐文案"],
                "hashtags": ["#zao_shih"],
                "brand_fit_notes": ["符合 DNA"],
            }

        self.app_module.generate_openai_json = fake_json
        self.client.post("/api/subscription", json={"plan": "FREE"})

        first = self.client.post("/api/generate-content", json={"context": "撖思??票??"})
        self.assertEqual(first.status_code, 200)
        quota = first.get_json()["subscription"]["quotas"]["content_generation"]
        self.assertEqual(quota["used"], 1)
        self.assertEqual(quota["remaining"], 0)

        second = self.client.post("/api/generate-content", json={"context": "?神銝??"})
        self.assertEqual(second.status_code, 429)

    def test_pro_content_generation_is_unlimited(self):
        self.seed_brand_dna()

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            return {"generated_content": ["??"], "hashtags": [], "brand_fit_notes": []}

        self.app_module.generate_openai_json = fake_json
        self.client.post("/api/subscription", json={"plan": "PRO"})
        for _ in range(2):
            response = self.client.post("/api/generate-content", json={"context": "撖急?獢?"})
            self.assertEqual(response.status_code, 200)
            quota = response.get_json()["subscription"]["quotas"]["content_generation"]
            self.assertIsNone(quota["limit"])
            self.assertIsNone(quota["remaining"])

    def test_content_generation_only_accepts_ig_or_fb_and_uses_brand_role_ta(self):
        self.seed_brand_dna()
        captured = {}

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            captured["prompt"] = prompt
            return {
                "platform": "Instagram",
                "final_caption": "照顧者語氣的早餐貼文",
                "generated_content": ["照顧者語氣的早餐貼文"],
                "hashtags": ["#zao_shih"],
                "compliance_notes": ["已依規範生成"],
            }

        self.app_module.generate_openai_json = fake_json

        invalid = self.client.post("/api/generate-content", json={"content_type": "google_business_update", "context": "test"})
        self.assertEqual(invalid.status_code, 400)

        response = self.client.post(
            "/api/generate-content",
            json={"content_type": "instagram", "context": "早餐新品", "forbidden_words": ["誇大"]},
        )
        self.assertEqual(response.status_code, 200)
        generated = response.get_json()["generated"]
        self.assertEqual(generated["platform"], "Instagram")
        self.assertEqual(generated["target_audience"], "重視便利早餐與安心感的家庭客")
        self.assertIn("重視便利早餐與安心感的家庭客", captured["prompt"])
        self.assertIn("3-6 relevant hashtags", captured["prompt"])
        self.assertIn("Facebook: more complete", captured["prompt"])
        self.assertIn("image_prompt must be based on the Brand DNA", captured["prompt"])
        image_prompt = generated["image_prompt"]
        self.assertIn("Instagram", image_prompt)
        self.assertIn("早餐新品", image_prompt)
        self.assertIn("照顧者語氣的早餐貼文", image_prompt)
        self.assertIn("重視便利早餐與安心感的家庭客", image_prompt)
        self.assertIn("No readable text", image_prompt)
        self.assertNotEqual(image_prompt, "warm Taiwanese breakfast shop social image")

    def test_marketing_demand_suggestions_use_brand_context_and_return_three(self):
        self.seed_brand_dna()
        captured = {}

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **kwargs):
            captured["prompt"] = prompt
            captured["task"] = kwargs.get("task")
            return {
                "suggestions": [
                    {"label": "安心早餐組合", "text": "請幫我寫一則主打安心早餐組合的 Instagram 貼文，吸引家庭客早上順路購買。"},
                    {"label": "外帶預訂提醒", "text": "請幫我寫一則尖峰時段外帶預訂提醒貼文，語氣溫暖親切。"},
                    {"label": "熟客互動提問", "text": "請幫我寫一則邀請熟客分享最常點餐點的社群互動文。"},
                    {"label": "多餘項目", "text": "這一項不應出現在回傳。"},
                ]
            }

        self.app_module.generate_openai_json = fake_json
        response = self.client.post("/api/marketing-demand-suggestions")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(captured["task"], "marketing_suggestions")
        self.assertIn("台式早午餐", captured["prompt"])
        self.assertIn("重視便利早餐與安心感的家庭客", captured["prompt"])
        self.assertEqual(len(data["suggestions"]), 3)
        self.assertEqual(data["suggestions"][0]["label"], "安心早餐組合")
        self.assertNotIn("多餘項目", [item["label"] for item in data["suggestions"]])

    def test_brand_image_history_detail_exposes_restorable_artifact_url(self):
        self.seed_brand_dna()
        original_create_openai_response = self.app_module.create_openai_response

        def fake_create_openai_response(*_args, **_kwargs):
            return SimpleNamespace(
                output=[
                    SimpleNamespace(
                        type="image_generation_call",
                        result=base64.b64encode(VALID_PNG_BYTES).decode("utf-8"),
                    )
                ]
            )

        try:
            self.app_module.openai_client = SimpleNamespace()
            self.app_module.create_openai_response = fake_create_openai_response
            response = self.client.post("/api/generate-brand-image", json={"prompt": "photorealistic egg pancake concept"})
        finally:
            self.app_module.create_openai_response = original_create_openai_response

        self.assertEqual(response.status_code, 200)
        generated = response.get_json()
        self.assertTrue(generated["file_url"].startswith("/artifacts/"))

        detail = self.client.get(f"/api/generation-detail/{generated['artifact_id']}")
        self.assertEqual(detail.status_code, 200)
        item = detail.get_json()["data"]
        self.assertEqual(item["artifact_type"], "brand_image")
        self.assertEqual(item["file_url"], generated["file_url"])
        self.assertEqual(item["payload"]["file_url"], generated["file_url"])

        history = self.client.get("/api/generation-history").get_json()["history"]
        history_item = next(item for item in history if item["id"] == generated["artifact_id"])
        self.assertEqual(history_item["file_url"], generated["file_url"])

        artifact_response = self.client.get(generated["file_url"])
        self.assertEqual(artifact_response.status_code, 200)
        self.assertEqual(artifact_response.data, VALID_PNG_BYTES)

    def test_brand_image_generation_links_back_to_content_artifact(self):
        self.seed_brand_dna()
        original_create_openai_response = self.app_module.create_openai_response

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            return {
                "platform": "Instagram",
                "final_caption": "蛋餅新口味今天上架，早餐多一個熱呼呼選擇。",
                "generated_content": ["蛋餅新口味今天上架，早餐多一個熱呼呼選擇。"],
                "hashtags": ["#蛋餅", "#早午餐"],
                "image_prompt": "photorealistic new egg pancake breakfast concept",
            }

        def fake_create_openai_response(*_args, **_kwargs):
            return SimpleNamespace(
                output=[
                    SimpleNamespace(
                        type="image_generation_call",
                        result=base64.b64encode(VALID_PNG_BYTES).decode("utf-8"),
                    )
                ]
            )

        try:
            self.app_module.generate_openai_json = fake_json
            self.app_module.openai_client = SimpleNamespace()
            self.app_module.create_openai_response = fake_create_openai_response
            content_response = self.client.post(
                "/api/generate-content",
                json={"content_type": "instagram", "context": "蛋餅新口味上架"},
            )
            self.assertEqual(content_response.status_code, 200)
            content_id = content_response.get_json()["artifact_id"]
            image_response = self.client.post(
                "/api/generate-brand-image",
                json={
                    "prompt": content_response.get_json()["generated"]["image_prompt"],
                    "content_artifact_id": content_id,
                },
            )
        finally:
            self.app_module.create_openai_response = original_create_openai_response

        self.assertEqual(image_response.status_code, 200)
        image_data = image_response.get_json()
        detail = self.client.get(f"/api/generation-detail/{content_id}")
        self.assertEqual(detail.status_code, 200)
        payload = detail.get_json()["data"]["payload"]
        self.assertEqual(payload["concept_image"]["artifact_id"], image_data["artifact_id"])
        self.assertEqual(payload["concept_image"]["file_url"], image_data["file_url"])
        self.assertEqual(payload["concept_image"]["prompt"], content_response.get_json()["generated"]["image_prompt"])

        latest = self.client.get("/api/latest-generated-post")
        self.assertEqual(latest.status_code, 200)
        latest_data = latest.get_json()
        self.assertEqual(latest_data["artifact_id"], content_id)
        self.assertEqual(latest_data["generated"]["concept_image"]["artifact_id"], image_data["artifact_id"])

    def test_latest_generated_post_pairs_adjacent_legacy_image(self):
        self.seed_brand_dna()
        content_payload = {
            "platform": "Instagram",
            "final_caption": "早餐新口味上架。",
            "generated_content": ["早餐新口味上架。"],
            "image_prompt": "legacy breakfast concept",
        }
        content_id = self.app_module.create_artifact(
            self.app_module.default_brand_id(),
            "content_generation",
            "legacy content",
            content_payload,
        )
        image_path = self.app_module.ARTIFACT_FOLDER / "legacy_concept.png"
        image_path.write_bytes(VALID_PNG_BYTES)
        image_id = self.app_module.create_artifact(
            self.app_module.default_brand_id(),
            "brand_image",
            "legacy image",
            {
                "prompt": "legacy breakfast concept",
                "image_path": self.app_module.safe_relative_path(image_path),
                "file_url": "/artifacts/legacy_concept.png",
            },
            file_path=self.app_module.safe_relative_path(image_path),
        )

        latest = self.client.get("/api/latest-generated-post")
        self.assertEqual(latest.status_code, 200)
        data = latest.get_json()
        self.assertEqual(data["artifact_id"], content_id)
        self.assertEqual(data["generated"]["concept_image"]["artifact_id"], image_id)
        self.assertEqual(data["generated"]["concept_image"]["file_url"], "/artifacts/legacy_concept.png")

    def test_market_prediction_returns_positive_summary_and_top_two(self):
        self.seed_brand_dna()

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            self.assertIn("market prediction", prompt)
            return {
                "overall_score": 84,
                "audience_predictions": [
                    {"audience": "家庭客", "acceptance_score": 90, "attraction_reason": "安心", "positive_response": "願意購買"},
                    {"audience": "上班族", "acceptance_score": 82, "attraction_reason": "便利", "positive_response": "願意收藏"},
                    {"audience": "大學生", "acceptance_score": 70, "attraction_reason": "有話題", "positive_response": "願意按讚"},
                ],
                "top_segments": [
                    {"rank": 1, "audience": "家庭客", "reason": "最重視安心早餐"},
                    {"rank": 2, "audience": "上班族", "reason": "重視快速便利"},
                    {"rank": 3, "audience": "大學生", "reason": "互動意願不錯"},
                ],
                "improvement_suggestions": ["不應回傳"],
            }

        self.app_module.generate_openai_json = fake_json
        response = self.client.post("/api/simulate", json={"content": "早餐文案", "audiences": ["家庭客", "上班族", "大學生"]})
        self.assertEqual(response.status_code, 200)
        result = response.get_json()["simulation"]
        self.assertEqual(len(result["top_segments"]), 2)
        self.assertEqual(result["top_segments"][0]["audience"], "家庭客")
        self.assertNotIn("improvement_suggestions", result)
        for row in result["audience_predictions"]:
            self.assertNotIn("concerns", row)
            self.assertNotIn("suggestions", row)

    def test_ai_workflows_create_artifacts(self):
        self.seed_brand_dna()
        self.seed_analyzed_source()

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            if "global_scan" in prompt:
                return {
                    "global_scan": {"readiness_score": 90, "notes": ["鞈?摰"]},
                    "archetype_position": {
                        "primary_archetype": "照顧者型品牌",
                        "confidence": 89,
                        "dimensions": [{"name": "照顧者型品牌", "score": 88}],
                        "rationale": "顧客資料顯示親切照顧與安心感。",
                    },
                    "brand_positioning": "溫暖在地早餐",
                    "brand_traits": ["親切", "安心"],
                    "brand_voice": "溫暖親切",
                    "target_audience": "家庭客",
                    "character": {
                        "name": "照顧者型品牌",
                        "archetype": "照顧者型品牌",
                        "positioning": "溫暖在地早餐",
                        "traits": ["親切", "安心"],
                        "voice": "溫暖親切",
                        "visual_personality": "明亮乾淨",
                        "target_audience": "家庭客",
                        "description": "照顧日常早餐需求",
                    },
                }
            if "risk_level" in prompt:
                return {
                    "is_compliant": True,
                    "risk_level": "low",
                    "violations": [],
                    "safe_content": "摰??",
                    "professional_rewrites": {"rewritten_versions": []},
                }
            if "audience_predictions" in prompt:
                return {
                    "overall_score": 82,
                    "audience_predictions": [{"audience": "家庭客", "acceptance_score": 88, "attraction_reason": "安心", "positive_response": "喜歡"}],
                    "top_segments": [{"rank": 1, "audience": "家庭客", "reason": "安心感高"}, {"rank": 2, "audience": "上班族", "reason": "便利"}],
                }
            return {"generated_content": ["早餐文案"], "hashtags": ["#zao_shih"], "brand_fit_notes": ["符合 DNA"]}

        self.app_module.generate_openai_json = fake_json

        content = self.client.post("/api/generate-content", json={"context": "撖思??票??"})
        risk = self.client.post("/api/risk-check", json={"content": "摰??"})
        simulation = self.client.post("/api/simulate", json={"content": "早餐文案", "personas": ["家庭客"]})
        diagnosis = self.client.post("/api/diagnosis/insights")

        for response in [content, risk, simulation, diagnosis]:
            self.assertEqual(response.status_code, 200)
            self.assertIn("artifact_id", response.get_json())

        diagnosis_payload = diagnosis.get_json()["insight"]
        self.assertIn("character", diagnosis_payload)
        self.assertNotIn("market_trends", diagnosis_payload)
        self.assertNotIn("benchmark_analysis", diagnosis_payload)
        dimensions = diagnosis_payload["archetype_position"]["dimensions"]
        self.assertEqual(len(dimensions), 12)
        self.assertEqual(dimensions[0]["key"], "caregiver")
        self.assertEqual(dimensions[0]["rank"], 1)
        self.assertTrue(dimensions[0]["is_top_five"])
        for field in ["explanation", "reason", "score_logic", "evidence"]:
            self.assertIn(field, dimensions[0])

        overview = self.client.get("/api/overview").get_json()
        overview_dimensions = overview["latest_diagnosis"]["payload"]["archetype_position"]["dimensions"]
        self.assertEqual(len(overview_dimensions), 12)
        self.assertEqual(sum(1 for row in overview_dimensions if row["is_top_five"]), 5)

        prediction_payload = simulation.get_json()["simulation"]
        self.assertIn("top_segments", prediction_payload)
        self.assertNotIn("improvement_suggestions", prediction_payload)
        self.assertNotIn("reaction_distribution", prediction_payload)
        for row in prediction_payload["audience_predictions"]:
            self.assertNotIn("concerns", row)
            self.assertNotIn("suggestions", row)

    def test_demo_import_is_manual_and_idempotent(self):
        first = self.client.post("/api/case/import").get_json()
        second = self.client.post("/api/case/import").get_json()
        self.assertTrue(first["success"])
        self.assertGreaterEqual(len(first["imported"]), 1)
        self.assertTrue(second["success"])
        self.assertEqual(len(second["imported"]), 0)
        self.assertGreaterEqual(len(second["skipped"]), 1)

    def test_reset_clears_workspace_data(self):
        self.client.post("/api/case/import")
        self.seed_brand_dna()

        before = self.client.get("/api/overview").get_json()["summary"]
        self.assertGreater(before["data_sources_count"], 0)
        self.assertTrue(before["brand_dna_configured"])

        reset = self.client.post("/api/reset").get_json()
        self.assertTrue(reset["success"])

        after = self.client.get("/api/overview").get_json()["summary"]
        self.assertEqual(after["data_sources_count"], 0)
        self.assertEqual(after["extracted_count"], 0)
        self.assertEqual(after["analyses_count"], 0)
        self.assertFalse(after["brand_dna_configured"])

    def test_text_source_upload_and_extract(self):
        response = self.client.post(
            "/api/sources",
            json={
                "source_type": "instagram",
                "title": "皜祈岫鞎潭?",
                "content": "?予??靘??嚗?暺??閬?敺?",
            },
        )
        self.assertEqual(response.status_code, 200)
        source_id = response.get_json()["source"]["id"]

        extraction = self.client.post(f"/api/sources/{source_id}/extract")
        self.assertEqual(extraction.status_code, 200)
        data = extraction.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["extraction"]["status"], "extracted")

    def test_source_with_url_and_text_uses_text_for_extraction(self):
        response = self.client.post(
            "/api/sources",
            json={
                "source_type": "instagram",
                "title": "Editable demo source",
                "url": "https://example.com/demo-source",
                "content": "This is manually supplied source text. It should be extracted without Playwright.",
            },
        )
        self.assertEqual(response.status_code, 200)
        source = response.get_json()["source"]
        self.assertEqual(source["input_kind"], "text")
        self.assertEqual(source["url"], "https://example.com/demo-source")

        extraction = self.client.post(f"/api/sources/{source['id']}/extract")
        self.assertEqual(extraction.status_code, 200)
        data = extraction.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["extraction"]["status"], "extracted")

    def test_data_hub_renders_auto_scan_controls(self):
        response = self.client.get("/data-hub")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'data-source-card="instagram"', response.data)
        self.assertIn(b'id="globalScanForm"', response.data)
        self.assertIn(b'id="globalScanBtn"', response.data)
        self.assertIn(b'id="manualPanel"', response.data)
        self.assertNotIn(b'id="fillGlobalDemoBtn"', response.data)
        self.assertNotIn(b'id="importCaseBtn"', response.data)
        self.assertIn(b'data-source-url="instagram"', response.data)
        self.assertIn(b'data-source-mode="instagram"', response.data)
        self.assertIn(b'data-toggle-source="instagram"', response.data)
        self.assertIn(b'data-crawl-social="instagram"', response.data)
        self.assertIn(b'data-fill-source-demo="instagram"', response.data)
        self.assertIn(b'data-fill-source-demo="recruitment"', response.data)
        self.assertIn(b'data-submit-source="instagram"', response.data)
        self.assertIn(b'data-submit-source="website"', response.data)
        self.assertIn(b'data-source-url="google_maps"', response.data)
        self.assertIn(b'DEFAULT_DEMO_CASE_KEY', response.data)
        self.assertIn(b'premium_coffee', response.data)
        self.assertIn("嶼光咖啡".encode("utf-8"), response.data)
        self.assertIn(b'name="instagram_auto_post_content_5"', response.data)
        self.assertIn(b'name="instagram_post_content_5"', response.data)
        self.assertIn(b'name="facebook_post_image_5"', response.data)
        self.assertIn(b'name="post_content_5"', response.data)
        self.assertIn(b'name="post_image_5"', response.data)

    def test_single_source_input_submit_manual_text_source(self):
        self.client.post("/api/reset")

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            return {
                "source_summary": "Manual website source analyzed",
                "scores": {},
                "keywords": ["manual"],
                "tone_markers": [],
                "risks_or_gaps": [],
                "content_opportunities": [],
            }

        self.app_module.generate_openai_json = fake_json

        response = self.client.post(
            "/api/source-input/website/submit",
            data={
                "website_mode": "manual",
                "website_content": "摰雯????嚗??亦???嚗撥隤輸?憌??冗??恥????",
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["source"]["source_type"], "website")
        self.assertEqual(data["source"]["input_kind"], "text")
        self.assertEqual(data["extraction"]["status"], "extracted")
        self.assertEqual(data["analysis"]["status"], "analyzed")

    def test_single_source_input_submit_url_source(self):
        self.client.post("/api/reset")

        def fake_extract_url(source):
            return (
                "Captured website source text that is long enough for source ingestion testing.",
                None,
                {"visited_pages": [{"url": source["url"], "status": "captured"}]},
            )

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            return {"source_summary": "ok", "scores": {}, "keywords": [], "tone_markers": [], "risks_or_gaps": [], "content_opportunities": []}

        self.app_module.extract_url_with_playwright = fake_extract_url
        self.app_module.generate_openai_json = fake_json

        response = self.client.post(
            "/api/source-input/website/submit",
            data={"website_mode": "url", "website_url": "https://example.com"},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["source"]["input_kind"], "url")
        self.assertEqual(data["extraction"]["status"], "extracted")
        self.assertEqual(data["analysis"]["status"], "analyzed")

    def test_single_source_input_submit_social_auto_posts_as_text_source(self):
        self.client.post("/api/reset")

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            return {"source_summary": "ok", "scores": {}, "keywords": [], "tone_markers": [], "risks_or_gaps": [], "content_opportunities": []}

        self.app_module.generate_openai_json = fake_json

        data = {
            "instagram_mode": "url",
            "instagram_url": "https://www.instagram.com/demo/",
        }
        for index in range(1, 6):
            data[f"instagram_auto_post_content_{index}"] = f"Auto captured Instagram post {index} with brand context."

        response = self.client.post("/api/source-input/instagram/submit", data=data, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["source"]["input_kind"], "text")
        self.assertEqual(payload["source"]["url"], "https://www.instagram.com/demo/")
        self.assertEqual(payload["source"]["metadata"]["auto_post_count"], 5)
        self.assertEqual(payload["extraction"]["status"], "extracted")

    def test_single_source_input_rejects_incomplete_manual_social_source(self):
        self.client.post("/api/reset")
        response = self.client.post(
            "/api/source-input/facebook/submit",
            data={
                "facebook_mode": "manual",
                "facebook_post_content_1": "One post without the required five images should fail.",
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 400)
        data = response.get_json()
        self.assertFalse(data["success"])

    def test_social_sources_are_configured_for_five_posts(self):
        self.assertEqual(self.app_module.URL_SOURCE_CONFIG["instagram"]["crawl_limit"], 5)
        self.assertEqual(self.app_module.URL_SOURCE_CONFIG["instagram"]["post_limit"], 5)
        self.assertEqual(self.app_module.URL_SOURCE_CONFIG["facebook"]["crawl_limit"], 5)
        self.assertEqual(self.app_module.URL_SOURCE_CONFIG["facebook"]["post_limit"], 5)

    def test_website_sources_use_agentic_explorer_config(self):
        website_config = self.app_module.URL_SOURCE_CONFIG["website"]
        self.assertEqual(website_config["crawl_limit"], 20)
        self.assertEqual(website_config["max_depth"], 3)
        self.assertEqual(website_config["exploration"], "agentic_site_explorer")

    def test_social_manual_upload_accepts_five_posts_with_images(self):
        self.client.post("/api/reset")
        data = {
            "source_type": "instagram",
            "title": "IG manual posts",
            "url": "https://www.instagram.com/example/",
        }
        for index in range(1, 6):
            data[f"post_content_{index}"] = f"Manual post {index} content with enough context."
            data[f"post_image_{index}"] = (BytesIO(VALID_PNG_BYTES), f"post-{index}.png")

        response = self.client.post("/api/sources", data=data, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 200)
        source = response.get_json()["source"]
        self.assertEqual(source["input_kind"], "text")
        self.assertEqual(source["metadata"]["manual_post_count"], 5)
        self.assertEqual(source["metadata"]["manual_image_count"], 5)
        self.assertEqual(len(source["metadata"]["manual_social_posts"]), 5)

        raw_path = self.app_module.absolute_stored_path(source["raw_path"])
        raw_text = raw_path.read_text(encoding="utf-8")
        self.assertIn("Post 5", raw_text)
        self.assertIn("Manual post 5 content", raw_text)

    def test_source_analysis_attaches_manual_social_images(self):
        self.client.post("/api/reset")
        data = {
            "source_type": "instagram",
            "title": "IG manual posts",
            "url": "https://www.instagram.com/example/",
        }
        for index in range(1, 6):
            data[f"post_content_{index}"] = f"Manual post {index} content with enough context."
            data[f"post_image_{index}"] = (BytesIO(VALID_PNG_BYTES), f"post-{index}.png")

        created = self.client.post("/api/sources", data=data, content_type="multipart/form-data").get_json()["source"]
        captured = {}

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            captured["prompt"] = prompt
            return {"source_summary": "ok", "scores": {}, "keywords": [], "tone_markers": [], "risks_or_gaps": [], "content_opportunities": []}

        self.app_module.generate_openai_json = fake_json
        response = self.client.post(f"/api/sources/{created['id']}/analyze")
        self.assertEqual(response.status_code, 200)

        prompt = captured["prompt"]
        self.assertIsInstance(prompt, list)
        content = prompt[0]["content"]
        self.assertEqual(len([item for item in content if item["type"] == "input_image"]), 5)
        self.assertIn("Image context: Post 1 image", [item["text"] for item in content if item["type"] == "input_text"])

    def test_serialize_source_cleans_legacy_manual_social_raw_text(self):
        self.client.post("/api/reset")
        metadata = {
            "manual_post_count": 5,
            "manual_social_posts": [{"index": index, "image_path": f"missing-{index}.png"} for index in range(1, 6)],
        }
        source_id = self.app_module.insert_raw_source(
            self.app_module.default_brand_id(),
            "facebook",
            "text",
            "Facebook ??鞎潭?",
            mime_type="text/plain",
            metadata=metadata,
        )
        source = self.app_module.fetch_source(source_id)
        self.app_module.create_extraction_result(
            source,
            "extracted",
            "Facebook ??頛詨鞎潭?嚗 5 蝭?\nImage filename: post-1.png\nImage path: runtime\\rawdata\\post-1.png",
        )

        serialized = self.app_module.serialize_source(self.app_module.fetch_source(source_id))
        self.assertEqual(serialized["title"], "Facebook 手動貼文")
        raw_text = serialized["latest_extraction"]["extracted_text"]
        self.assertIn("Facebook 手動輸入貼文，共 5 篇", raw_text)
        self.assertIn("圖片檔名： post-1.png", raw_text)
        self.assertIn("圖片路徑： runtime\\rawdata\\post-1.png", raw_text)

    def test_social_post_candidate_urls_extracts_latest_links(self):
        html = """
        <a href="/p/one/">one</a>
        <a href="/reel/two/">two</a>
        <a href="/p/three/">three</a>
        <a href="/about/">about</a>
        <a href="/p/four/">four</a>
        <a href="/p/five/">five</a>
        <a href="/p/six/">six</a>
        """
        candidates = self.app_module.social_post_candidate_urls("https://www.instagram.com/demo/", html, "instagram", 5)
        self.assertEqual(len(candidates), 5)
        self.assertEqual(candidates[0], "https://www.instagram.com/p/one/")
        self.assertEqual(candidates[-1], "https://www.instagram.com/p/five/")

    def test_social_preview_extracts_five_post_fields(self):
        self.client.post("/api/reset")

        def fake_extract_url(source):
            text = "\n\n".join(
                f"## https://www.instagram.com/p/post-{index}/\nPost {index} captured content with enough details."
                for index in range(1, 6)
            )
            return text, None, {"visited_pages": [{"url": source["url"], "status": "captured"}]}

        self.app_module.extract_url_with_playwright = fake_extract_url
        response = self.client.post(
            "/api/global-scan/social-preview",
            json={"source_type": "instagram", "url": "https://www.instagram.com/demo/"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(len(data["posts"]), 5)
        self.assertEqual(data["posts"][0]["content"], "Post 1 captured content with enough details.")

    def test_website_candidate_links_prioritize_brand_pages(self):
        html = """
        <header><nav>
            <a href="/privacy">privacy</a>
            <a href="/about">關於品牌</a>
            <a href="/menu">菜單</a>
            <a href="/member/login">??餃</a>
            <a href="/contact?utm_source=test">聯絡資訊</a>
        </nav></header>
        <main><a href="https://external.example.com/about">external</a></main>
        """
        candidates = self.app_module.extract_website_candidate_links(
            "https://brand.example.com/",
            "https://brand.example.com/",
            html,
            depth=1,
        )
        urls = [item["url"] for item in candidates]
        self.assertIn("https://brand.example.com/about", urls)
        self.assertIn("https://brand.example.com/menu", urls)
        self.assertIn("https://brand.example.com/contact", urls)
        self.assertNotIn("https://brand.example.com/member/login", urls)
        self.assertNotIn("https://brand.example.com/privacy", urls)
        self.assertTrue(urls.index("https://brand.example.com/menu") < len(urls))

    def test_global_scan_requires_three_url_source_types(self):
        self.client.post("/api/reset")
        response = self.client.post(
            "/api/global-scan/run",
            json={"urls": {"instagram": "https://example.com/ig", "website": "https://example.com"}},
        )
        self.assertEqual(response.status_code, 400)
        data = response.get_json()
        self.assertFalse(data["success"])
        self.assertEqual(data["provided_url_sources"], 2)

    def test_global_scan_accepts_mixed_manual_social_and_url_sources(self):
        self.client.post("/api/reset")

        def fake_extract_url(source):
            return (
                "Captured website source text that is long enough for automated analysis. " * 2,
                None,
                {"visited_pages": [{"url": source["url"], "status": "captured"}]},
            )

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            if "brand_name" in prompt:
                return {
                    "brand_name": "Mixed Brand",
                    "handle": "mixed",
                    "archetype": "Practical",
                    "personality_scores": {
                        "sincerity": 80,
                        "activity": 70,
                        "competence": 75,
                        "authenticity": 78,
                        "competitiveness": 60,
                    },
                    "keywords": ["mixed"],
                    "forbidden_words": [],
                    "tone_guide": {},
                    "audience_segments": [],
                    "content_guidelines": [],
                    "improvement_priorities": [],
                    "summary": "Mixed scan summary.",
                }
            return {"source_summary": "ok", "scores": {}, "keywords": [], "tone_markers": [], "risks_or_gaps": [], "content_opportunities": []}

        self.app_module.extract_url_with_playwright = fake_extract_url
        self.app_module.generate_openai_json = fake_json

        data = {
            "instagram_mode": "manual",
            "facebook_mode": "manual",
            "website_mode": "url",
            "website_url": "https://example.com",
        }
        for source_type in ["instagram", "facebook"]:
            for index in range(1, 6):
                data[f"{source_type}_post_content_{index}"] = f"{source_type} manual post {index} content."
                data[f"{source_type}_post_image_{index}"] = (
                    BytesIO(VALID_PNG_BYTES),
                    f"{source_type}-{index}.png",
                )

        response = self.client.post("/api/global-scan/run", data=data, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 200)
        result = response.get_json()["result"]
        self.assertEqual(len(result["created_sources"]), 3)
        self.assertEqual(len(result["successful_source_ids"]), 3)
        self.assertEqual(len(result["successful_url_source_ids"]), 1)
        created_by_type = {item["source_type"]: item for item in result["created_sources"]}
        self.assertEqual(created_by_type["instagram"]["input_kind"], "text")
        self.assertEqual(created_by_type["facebook"]["input_kind"], "text")
        self.assertEqual(created_by_type["website"]["input_kind"], "url")

    def test_global_scan_rejects_incomplete_manual_social_source(self):
        self.client.post("/api/reset")
        data = {
            "instagram_mode": "manual",
            "instagram_post_content_1": "Only one post is not enough.",
            "website_mode": "url",
            "website_url": "https://example.com",
            "recruitment_mode": "url",
            "recruitment_url": "https://example.com/jobs",
        }
        response = self.client.post("/api/global-scan/run", data=data, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.get_json()["success"])

    def test_global_scan_builds_dna_when_url_source_fails_but_manual_sources_succeed(self):
        self.client.post("/api/reset")

        def fake_extract_url(source):
            raise RuntimeError("blocked public page")

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            if "brand_name" in prompt:
                return {
                    "brand_name": "Manual Resilient Brand",
                    "handle": "manual",
                    "archetype": "Resilient",
                    "personality_scores": {
                        "sincerity": 80,
                        "activity": 70,
                        "competence": 75,
                        "authenticity": 78,
                        "competitiveness": 60,
                    },
                    "keywords": [],
                    "forbidden_words": [],
                    "tone_guide": {},
                    "audience_segments": [],
                    "content_guidelines": [],
                    "improvement_priorities": [],
                    "summary": "Manual sources carried the scan.",
                }
            return {"source_summary": "ok", "scores": {}, "keywords": [], "tone_markers": [], "risks_or_gaps": [], "content_opportunities": []}

        self.app_module.extract_url_with_playwright = fake_extract_url
        self.app_module.generate_openai_json = fake_json

        data = {
            "instagram_mode": "manual",
            "facebook_mode": "manual",
            "website_mode": "url",
            "website_url": "https://example.com",
        }
        for source_type in ["instagram", "facebook"]:
            for index in range(1, 6):
                data[f"{source_type}_post_content_{index}"] = f"{source_type} manual post {index} content."
                data[f"{source_type}_post_image_{index}"] = (
                    BytesIO(VALID_PNG_BYTES),
                    f"{source_type}-{index}.png",
                )

        response = self.client.post("/api/global-scan/run", data=data, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 200)
        result = response.get_json()["result"]
        self.assertEqual(len(result["successful_url_source_ids"]), 0)
        self.assertEqual(len(result["successful_source_ids"]), 2)
        statuses = {item["source_type"]: item["status"] for item in result["extracted"]}
        self.assertEqual(statuses["website"], "error")
        self.assertIn("brand_dna", result)

    def test_global_scan_creates_sources_and_brand_dna(self):
        self.client.post("/api/reset")

        def fake_extract_url(source):
            return (
                f"Captured public page for {source['source_type']} at {source['url']}. "
                "This source has enough text for automated extraction and analysis. " * 2,
                None,
                {"visited_pages": [{"url": source["url"], "status": "captured"}]},
            )

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            if "brand_name" in prompt:
                return {
                    "brand_name": "Test Brand",
                    "handle": "test",
                    "archetype": "Warm expert",
                    "personality_scores": {
                        "sincerity": 80,
                        "activity": 60,
                        "competence": 75,
                        "authenticity": 82,
                        "competitiveness": 55,
                    },
                    "keywords": ["fresh", "friendly"],
                    "forbidden_words": [],
                    "tone_guide": {"voice": "clear"},
                    "audience_segments": [],
                    "content_guidelines": ["Keep claims specific."],
                    "improvement_priorities": ["Clarify operating hours."],
                    "summary": "Automated global scan summary.",
                }
            return {
                "source_summary": "Analyzed source",
                "scores": {
                    "sincerity": {"score": 80, "reasoning": "Friendly"},
                    "activity": {"score": 60, "reasoning": "Regular updates"},
                    "competence": {"score": 75, "reasoning": "Clear info"},
                    "authenticity": {"score": 82, "reasoning": "Specific evidence"},
                    "competitiveness": {"score": 55, "reasoning": "Some positioning"},
                },
                "keywords": ["fresh"],
                "tone_markers": ["clear"],
                "risks_or_gaps": [],
                "content_opportunities": [],
            }

        self.app_module.extract_url_with_playwright = fake_extract_url
        self.app_module.generate_openai_json = fake_json

        response = self.client.post(
            "/api/global-scan/run",
            json={
                "urls": {
                    "instagram": "https://example.com/ig",
                    "website": "https://example.com",
                    "recruitment": "https://example.com/jobs",
                },
                "selected_rules": ["食品安全", "個資保護"],
                "internal_rules": "No exaggerated health claims.",
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["job"]["status"], "done")
        self.assertEqual(len(data["result"]["successful_url_source_ids"]), 3)
        self.assertEqual(len(data["result"]["created_sources"]), 5)
        self.assertIn("brand_dna", data["result"])

        overview = self.client.get("/api/overview").get_json()["summary"]
        self.assertTrue(overview["brand_dna_configured"])

    def test_global_scan_continues_when_one_crawler_fails(self):
        self.client.post("/api/reset")

        def fake_extract_url(source):
            if source["source_type"] == "instagram":
                raise RuntimeError("blocked public page")
            return (
                "Captured source text that is long enough for the automated workflow. " * 2,
                None,
                {"visited_pages": [{"url": source["url"], "status": "captured"}]},
            )

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            if "brand_name" in prompt:
                return {
                    "brand_name": "Partial Brand",
                    "handle": "partial",
                    "archetype": "Resilient",
                    "personality_scores": {
                        "sincerity": 70,
                        "activity": 65,
                        "competence": 72,
                        "authenticity": 74,
                        "competitiveness": 58,
                    },
                    "keywords": [],
                    "forbidden_words": [],
                    "tone_guide": {},
                    "audience_segments": [],
                    "content_guidelines": [],
                    "improvement_priorities": [],
                    "summary": "Partial scan still created DNA.",
                }
            return {"source_summary": "ok", "scores": {}, "keywords": [], "tone_markers": [], "risks_or_gaps": [], "content_opportunities": []}

        self.app_module.extract_url_with_playwright = fake_extract_url
        self.app_module.generate_openai_json = fake_json

        response = self.client.post(
            "/api/global-scan/run",
            json={
                "urls": {
                    "instagram": "https://example.com/ig",
                    "website": "https://example.com",
                    "recruitment": "https://example.com/jobs",
                }
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(len(data["result"]["successful_url_source_ids"]), 2)
        statuses = {item["source_type"]: item["status"] for item in data["result"]["extracted"]}
        self.assertEqual(statuses["instagram"], "error")
        self.assertEqual(statuses["website"], "extracted")

    def test_source_fallback_creates_linked_manual_source(self):
        self.client.post("/api/reset")

        def fake_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            return {
                "source_summary": "Manual fallback analyzed",
                "scores": {},
                "keywords": [],
                "tone_markers": [],
                "risks_or_gaps": [],
                "content_opportunities": [],
            }

        self.app_module.generate_openai_json = fake_json
        source_id = self.app_module.insert_raw_source(
            self.app_module.default_brand_id(),
            "instagram",
            "url",
            "Instagram blocked source",
            url="https://example.com/ig",
        )
        response = self.client.post(
            f"/api/sources/{source_id}/fallback",
            json={"content": "Manual fallback content for a blocked public page."},
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["source"]["metadata"]["fallback_for_source_id"], source_id)
        self.assertEqual(data["analysis"]["status"], "analyzed")

    def test_system_logs_are_queryable_and_written_to_file(self):
        brand_id = self.app_module.default_brand_id()
        job_id = self.app_module.create_job(brand_id, "log_test", {"purpose": "unit"})
        self.app_module.update_job(job_id, "done", result={"ok": True}, mark_started=True, mark_finished=True)

        response = self.client.get(f"/api/jobs/{job_id}/logs")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["success"])
        event_types = {item["event_type"] for item in data["logs"]}
        self.assertIn("job.created", event_types)
        self.assertIn("job.status_changed", event_types)

        self.assertTrue(self.app_module.SYSTEM_LOG_PATH.exists())
        log_text = self.app_module.SYSTEM_LOG_PATH.read_text(encoding="utf-8")
        self.assertIn("job.created", log_text)

    def test_pipeline_with_mocked_openai(self):
        def fake_openai_json(prompt, system_instruction, temperature=0.2, max_output_tokens=4096, **_):
            if "brand_archetype" in prompt and "archetype_scores" in prompt:
                return {
                    "brand_name": "?拐??拙?擗?",
                    "handle": "zao_shih",
                    "archetype": "照顧者型品牌",
                    "brand_archetype": {
                        "key": "caregiver",
                        "name_zh": "照顧者",
                        "name_en": "The Caregiver",
                        "role_name": "照顧者型品牌",
                        "confidence": 88,
                        "rationale": "親切服務與在地日常感明確。",
                    },
                    "archetype_scores": {"caregiver": 88, "everyman": 80},
                    "brand_character": {
                        "name": "照顧者型品牌",
                        "positioning": "在地早餐",
                        "traits": ["?曉?", "?渡?砍?"],
                        "voice": "皜??湔",
                        "visual_personality": "明亮親切",
                        "target_audience": "家庭客",
                        "description": "?拐??臭??皜??砍?",
                    },
                    "personality_scores": {
                        "sincerity": 88,
                        "activity": 62,
                        "competence": 76,
                        "authenticity": 91,
                        "competitiveness": 70,
                    },
                    "keywords": ["?曉?", "?渡?砍?", "??撖行?"],
                    "forbidden_words": ["瘝餌?", "靽?100%"],
                    "tone_guide": {"voice": "皜??湔"},
                    "audience_segments": [],
                    "content_guidelines": [],
                    "improvement_priorities": ["蝑????內"],
                    "summary": "?拐??臭??皜??砍?撱箇?靽∩遙???撠???",
                }
            return {
                "source_summary": "靘???",
                "scores": {
                    "sincerity": {"score": 88, "reasoning": "?祕"},
                    "activity": {"score": 62, "reasoning": "?砍??餌?"},
                    "competence": {"score": 76, "reasoning": "?曉??釭"},
                    "authenticity": {"score": 91, "reasoning": "隤除?渡"},
                    "competitiveness": {"score": 70, "reasoning": "?寡??"},
                },
                "keywords": ["?曉?"],
                "tone_markers": ["?渡"],
                "risks_or_gaps": [],
                "content_opportunities": [],
            }

        self.app_module.generate_openai_json = fake_openai_json
        self.client.post("/api/case/import")
        response = self.client.post("/api/pipeline/run", json={})
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["job"]["status"], "done")

        dna = self.client.get("/api/brand-dna").get_json()
        self.assertTrue(dna["configured"])
        self.assertEqual(dna["brand_dna"]["handle"], "zao_shih")


if __name__ == "__main__":
    unittest.main()
