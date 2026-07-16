"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface LLMSettings {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

interface SettingsResponse {
  theme: "verdigris" | "ocean" | "sunset" | "ink";
  llm: LLMSettings;
  _hasRealKey: boolean;
}

const THEME_OPTIONS: {
  id: SettingsResponse["theme"];
  name: string;
  hint: string;
  swatch: { bg: string; accent: string };
}[] = [
  {
    id: "verdigris",
    name: "Verdigris",
    hint: "深青墨绿 · 古铜金（默认）",
    swatch: { bg: "#1f4a48", accent: "#c9a87c" },
  },
  {
    id: "ocean",
    name: "Ocean",
    hint: "深海军蓝 · 天青蓝（科技感）",
    swatch: { bg: "#0a2540", accent: "#4f9eff" },
  },
  {
    id: "sunset",
    name: "Sunset",
    hint: "深紫红 · 落日金（温暖）",
    swatch: { bg: "#4a1f23", accent: "#ffae5c" },
  },
  {
    id: "ink",
    name: "Ink",
    hint: "深炭灰 · 银白（极简黑白）",
    swatch: { bg: "#15171c", accent: "#c7d0e0" },
  },
];

type Status = "idle" | "saving" | "saved" | "error" | "testing" | "tested";

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 表单本地状态（API Key 单独处理 —— 后端用 "__KEEP__" 表示保留旧值）
  const [theme, setTheme] = useState<SettingsResponse["theme"]>("verdigris");
  const [provider, setProvider] = useState("MiniMax");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState(""); // 用户输入；保存时若空 → "__KEEP__" 或清空
  const [hasRealKey, setHasRealKey] = useState(false);
  const [model, setModel] = useState("MiniMax-M3");

  const [status, setStatus] = useState<Status>("idle");
  const [testMsg, setTestMsg] = useState("");
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/settings", { cache: "no-store" });
      const data = (await r.json()) as SettingsResponse;
      setSettings(data);
      setTheme(data.theme);
      setProvider(data.llm.provider);
      setBaseUrl(data.llm.baseUrl);
      setApiKey(""); // 永远不在前端留明文
      setHasRealKey(data._hasRealKey);
      setModel(data.llm.model);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载设置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 主题切换：本地预览（保存后才持久化）
  useEffect(() => {
    if (!theme) return;
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* 隐私模式可能禁用 localStorage */
    }
  }, [theme]);

  const handleSave = useCallback(async () => {
    setStatus("saving");
    setError("");
    try {
      // apiKey 输入策略：
      //   - 用户输入了非空字符串 → 用新值
      //   - 字段为空且原本 _hasRealKey === true → "__KEEP__" 保留
      //   - 字段为空且原本无 key → "" 清空
      const keyPayload =
        apiKey.length > 0
          ? apiKey
          : hasRealKey
          ? "__KEEP__"
          : "";

      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme,
          llm: {
            provider,
            baseUrl,
            apiKey: keyPayload,
            model,
          },
        }),
      });
      const data = (await r.json()) as SettingsResponse;
      setSettings(data);
      setHasRealKey(data._hasRealKey);
      setApiKey(""); // 清空输入框
      setStatus("saved");
      setSavedAt(Date.now());
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setStatus("error");
    }
  }, [theme, provider, baseUrl, apiKey, model, hasRealKey]);

  const handleClearKey = useCallback(async () => {
    setStatus("saving");
    setError("");
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llm: { apiKey: "" } }),
      });
      const data = (await r.json()) as SettingsResponse;
      setSettings(data);
      setHasRealKey(data._hasRealKey);
      setApiKey("");
      setStatus("saved");
      setSavedAt(Date.now());
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "清除失败");
      setStatus("error");
    }
  }, []);

  const handleTest = useCallback(async () => {
    setStatus("testing");
    setTestMsg("");
    setTestOk(null);
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        cache: "no-store",
      });
      const data = (await r.json()) as { ok: boolean; message: string };
      setTestOk(data.ok);
      setTestMsg(data.message);
      setStatus("tested");
    } catch (e) {
      setTestOk(false);
      setTestMsg(e instanceof Error ? e.message : "测试失败");
      setStatus("tested");
    }
  }, []);

  if (loading) {
    return (
      <div className="container">
        <div className="row">
          <span className="spinner" />
          <span className="muted">加载设置中…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container settings-page">
      <div className="topbar">
        <div className="brand">
          <div className="logo">⚙</div>
          <div>
            <h1>设置</h1>
            <p>主题配色 · LLM 配置 · 数据偏好</p>
          </div>
        </div>
        <div className="row">
          <Link className="btn" href="/">
            返回首页
          </Link>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      {/* ============ 主题 ============ */}
      <section className="card settings-section">
        <div className="settings-section-head">
          <p className="section-title">主题配色</p>
          <p className="muted settings-hint">
            切换会立即生效。保存到本地后下次打开仍是所选主题。
          </p>
        </div>

        <div className="theme-grid">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`theme-card ${theme === opt.id ? "active" : ""}`}
              onClick={() => setTheme(opt.id)}
              aria-pressed={theme === opt.id}
            >
              <div
                className="theme-swatch"
                style={{
                  background: `radial-gradient(ellipse 80% 100% at 30% 0%, ${opt.swatch.accent}33 0%, transparent 70%), ${opt.swatch.bg}`,
                }}
              >
                <div
                  className="theme-swatch-dot"
                  style={{ background: opt.swatch.accent }}
                />
              </div>
              <div className="theme-card-meta">
                <div className="theme-card-name">{opt.name}</div>
                <div className="theme-card-hint">{opt.hint}</div>
              </div>
              {theme === opt.id && (
                <span className="theme-card-check" aria-hidden>
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* ============ LLM 配置 ============ */}
      <section className="card settings-section">
        <div className="settings-section-head">
          <p className="section-title">LLM 配置</p>
          <p className="muted settings-hint">
            填入 API Key 后启用数据理解、计划、终审和自然语言微调；不填则使用本地规则模式（local）。
            配置修改后无需重启服务器，下一次分析自动生效。
          </p>
        </div>

        <div className="form-grid">
          <label className="form-row">
            <span className="form-label">服务商</span>
            <input
              className="form-input"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="MiniMax / OpenAI / Claude …"
            />
          </label>

          <label className="form-row">
            <span className="form-label">Base URL</span>
            <input
              className="form-input"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
            />
          </label>

          <label className="form-row">
            <span className="form-label">
              API Key
              <span className="form-tag">
                {hasRealKey ? "已配置（输入新值可覆盖）" : "未配置"}
              </span>
            </span>
            <input
              className="form-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                hasRealKey ? "••••••••（已脱敏，重新输入覆盖）" : "sk-..."
              }
              spellCheck={false}
              autoComplete="off"
            />
          </label>

          <label className="form-row">
            <span className="form-label">模型名</span>
            <input
              className="form-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="MiniMax-M3 / gpt-4o-mini / claude-3-5-sonnet …"
            />
          </label>
        </div>

        <div className="settings-actions">
          <button
            type="button"
            className="btn"
            onClick={handleTest}
            disabled={status === "testing"}
          >
            {status === "testing" ? (
              <>
                <span className="spinner spinner-mini" /> 测试中…
              </>
            ) : (
              "测试连接"
            )}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={status === "saving"}
          >
            {status === "saving" ? (
              <>
                <span className="spinner spinner-mini" /> 保存中…
              </>
            ) : status === "saved" ? (
              "✓ 已保存"
            ) : (
              "保存设置"
            )}
          </button>

          {hasRealKey && (
            <button
              type="button"
              className="btn"
              onClick={handleClearKey}
              disabled={status === "saving"}
              title="清除已保存的 API Key，回到本地模式"
            >
              清除 API Key
            </button>
          )}

          {testOk !== null && (
            <span
              className={`settings-test-pill ${testOk ? "ok" : "fail"}`}
              role="status"
            >
              {testOk ? "✓" : "✗"} {testMsg}
            </span>
          )}

          {savedAt && status === "idle" && (
            <span className="muted settings-saved-hint">
              上次保存于 {new Date(savedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        <div className="settings-foot">
          <span className="muted">
            运行时状态：
            <strong className={hasRealKey ? "ok-text" : "warn-text"}>
              {hasRealKey ? "已启用真实 LLM" : "本地模式（local）"}
            </strong>
            {hasRealKey && settings && (
              <> · 模型 <code className="inline-code">{settings.llm.model}</code></>
            )}
          </span>
        </div>
      </section>

      <section className="card settings-section">
        <div className="settings-section-head">
          <p className="section-title">数据管理</p>
        </div>
        <p className="muted">
          上传 / 删除数据集请到 <Link href="/">首页</Link> 操作。
          服务器端设置文件位于 <code className="inline-code">.data/settings.json</code>。
        </p>
      </section>
    </div>
  );
}
