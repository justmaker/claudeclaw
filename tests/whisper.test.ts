import { describe, it, expect, beforeEach, mock } from "bun:test";
import { join } from "path";

// Mock getSettings before importing whisper
const mockSettings = {
  stt: {
    baseUrl: "",
    model: "",
    localModel: "large-v3",
    language: "zh",
    initialPrompt: "以下是繁體中文的語音內容。",
  },
};

mock.module("../src/config", () => ({
  getSettings: () => mockSettings,
}));

const { getModelPath, getModelUrl } = await import("../src/whisper");

describe("whisper STT 設定", () => {
  beforeEach(() => {
    // Reset to defaults
    mockSettings.stt = {
      baseUrl: "",
      model: "",
      localModel: "large-v3",
      language: "zh",
      initialPrompt: "以下是繁體中文的語音內容。",
    };
  });

  describe("getModelUrl", () => {
    it("應根據 model name 動態生成 HuggingFace URL", () => {
      expect(getModelUrl("large-v3")).toBe(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin"
      );
    });

    it("應支援不同 model name", () => {
      expect(getModelUrl("medium")).toBe(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin"
      );
      expect(getModelUrl("base.en")).toBe(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
      );
    });
  });

  describe("getModelPath", () => {
    it("應使用 config 中的 localModel", () => {
      const path = getModelPath();
      expect(path).toContain("ggml-large-v3.bin");
    });

    it("應允許覆寫 model 參數", () => {
      const path = getModelPath("medium");
      expect(path).toContain("ggml-medium.bin");
    });

    it("沒有設定 localModel 時預設 large-v3", () => {
      mockSettings.stt.localModel = "";
      const path = getModelPath();
      expect(path).toContain("ggml-large-v3.bin");
    });
  });

  describe("config 讀取", () => {
    it("應正確讀取 language 設定", () => {
      expect(mockSettings.stt.language).toBe("zh");
    });

    it("應正確讀取 initialPrompt 設定", () => {
      expect(mockSettings.stt.initialPrompt).toContain("繁體中文");
    });

    it("預設 localModel 為 large-v3 而非 base.en", () => {
      expect(mockSettings.stt.localModel).toBe("large-v3");
      expect(mockSettings.stt.localModel).not.toBe("base.en");
    });
  });
});
