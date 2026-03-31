import { describe, test, expect } from "bun:test";
import {
  extractVoiceTag,
  parseVoiceCommand,
  shouldSynthesizeVoice,
  parseTtsConfig,
  DEFAULT_TTS_CONFIG,
  type TtsConfig,
} from "../src/tts";

describe("extractVoiceTag", () => {
  test("有 [voice] tag 時回傳 triggered=true 並移除 tag", () => {
    const result = extractVoiceTag("你好 [voice] 世界");
    expect(result.triggered).toBe(true);
    expect(result.text).toBe("你好  世界");
  });

  test("沒有 [voice] tag 時回傳 triggered=false", () => {
    const result = extractVoiceTag("你好世界");
    expect(result.triggered).toBe(false);
    expect(result.text).toBe("你好世界");
  });

  test("自訂 pattern", () => {
    const result = extractVoiceTag("你好 #speak 世界", "#speak");
    expect(result.triggered).toBe(true);
    expect(result.text).toBe("你好  世界");
  });

  test("多個 tag 都移除", () => {
    const result = extractVoiceTag("[voice] 你好 [voice]");
    expect(result.triggered).toBe(true);
    expect(result.text).toBe("你好");
  });
});

describe("parseVoiceCommand", () => {
  test("解析 /voice 指令", () => {
    expect(parseVoiceCommand("/voice 你好")).toBe("你好");
  });

  test("多行文字", () => {
    expect(parseVoiceCommand("/voice 你好\n世界")).toBe("你好\n世界");
  });

  test("非 /voice 指令回傳 null", () => {
    expect(parseVoiceCommand("你好")).toBeNull();
    expect(parseVoiceCommand("/help")).toBeNull();
  });

  test("/voice 後面沒文字回傳 null", () => {
    expect(parseVoiceCommand("/voice")).toBeNull();
    expect(parseVoiceCommand("/voice ")).toBeNull();
  });
});

describe("shouldSynthesizeVoice", () => {
  const enabledConfig: TtsConfig = { ...DEFAULT_TTS_CONFIG, enabled: true };
  const disabledConfig: TtsConfig = { ...DEFAULT_TTS_CONFIG, enabled: false };

  test("disabled 時不合成", () => {
    const result = shouldSynthesizeVoice("你好", disabledConfig, false);
    expect(result.shouldSpeak).toBe(false);
  });

  test("/voice 指令強制合成", () => {
    const result = shouldSynthesizeVoice("你好", enabledConfig, true);
    expect(result.shouldSpeak).toBe(true);
    expect(result.textToSpeak).toBe("你好");
  });

  test("[voice] tag 觸發合成", () => {
    const result = shouldSynthesizeVoice("你好 [voice] 世界", enabledConfig, false);
    expect(result.shouldSpeak).toBe(true);
    expect(result.textToSpeak).toBe("你好  世界");
  });

  test("autoVoice 啟用時所有回覆都合成", () => {
    const autoConfig = { ...enabledConfig, autoVoice: true };
    const result = shouldSynthesizeVoice("你好", autoConfig, false);
    expect(result.shouldSpeak).toBe(true);
    expect(result.textToSpeak).toBe("你好");
  });

  test("沒有觸發條件時不合成", () => {
    const result = shouldSynthesizeVoice("你好", enabledConfig, false);
    expect(result.shouldSpeak).toBe(false);
  });
});

describe("parseTtsConfig", () => {
  test("undefined 回傳預設值", () => {
    const config = parseTtsConfig(undefined);
    expect(config.enabled).toBe(false);
    expect(config.provider).toBe("edge-tts");
    expect(config.voice).toBe("zh-TW-HsiaoChenNeural");
    expect(config.speed).toBe(1.0);
    expect(config.triggerPattern).toBe("[voice]");
    expect(config.autoVoice).toBe(false);
  });

  test("解析有效設定", () => {
    const config = parseTtsConfig({
      enabled: true,
      provider: "openai",
      voice: "nova",
      speed: 1.5,
      triggerPattern: "#say",
      autoVoice: true,
    });
    expect(config.enabled).toBe(true);
    expect(config.provider).toBe("openai");
    expect(config.voice).toBe("nova");
    expect(config.speed).toBe(1.5);
    expect(config.triggerPattern).toBe("#say");
    expect(config.autoVoice).toBe(true);
  });

  test("無效 provider 回退預設", () => {
    const config = parseTtsConfig({ provider: "invalid" });
    expect(config.provider).toBe("edge-tts");
  });

  test("speed 超出範圍回退預設", () => {
    expect(parseTtsConfig({ speed: 0 }).speed).toBe(1.0);
    expect(parseTtsConfig({ speed: 5 }).speed).toBe(1.0);
    expect(parseTtsConfig({ speed: -1 }).speed).toBe(1.0);
  });

  test("空字串回退預設 voice", () => {
    expect(parseTtsConfig({ voice: "" }).voice).toBe("zh-TW-HsiaoChenNeural");
    expect(parseTtsConfig({ voice: "  " }).voice).toBe("zh-TW-HsiaoChenNeural");
  });
});
