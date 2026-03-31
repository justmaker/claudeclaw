import { describe, it, expect } from "vitest";
import { classifyByRegex } from "../src/intent-classifier.js";

describe("classifyByRegex", () => {
  // --- Hire patterns ---
  describe("hire patterns", () => {
    it("hire X (English)", () => {
      const r = classifyByRegex("hire alice");
      expect(r).toEqual({ action: "hire", names: ["alice"] });
    });

    it("hire multiple (comma)", () => {
      const r = classifyByRegex("hire alice, bob, charlie");
      expect(r).toEqual({ action: "hire", names: ["alice", "bob", "charlie"] });
    });

    it("hire multiple (和)", () => {
      const r = classifyByRegex("hire alice 和 bob");
      expect(r).toEqual({ action: "hire", names: ["alice", "bob"] });
    });

    it("派出 X", () => {
      const r = classifyByRegex("派出 gpt");
      expect(r).toEqual({ action: "hire", names: ["gpt"] });
    });

    it("派 X", () => {
      const r = classifyByRegex("派 claude");
      expect(r).toEqual({ action: "hire", names: ["claude"] });
    });

    it("叫 X 出來", () => {
      const r = classifyByRegex("叫 gemini 出來");
      expect(r).toEqual({ action: "hire", names: ["gemini"] });
    });

    it("開 X", () => {
      const r = classifyByRegex("開 copilot");
      expect(r).toEqual({ action: "hire", names: ["copilot"] });
    });

    it("召喚 X", () => {
      const r = classifyByRegex("召喚 claude");
      expect(r).toEqual({ action: "hire", names: ["claude"] });
    });

    it("出征 X", () => {
      const r = classifyByRegex("出征 alice");
      expect(r).toEqual({ action: "hire", names: ["alice"] });
    });
  });

  // --- Fire patterns ---
  describe("fire patterns", () => {
    it("fire X (English)", () => {
      const r = classifyByRegex("fire alice");
      expect(r).toEqual({ action: "fire", names: ["alice"] });
    });

    it("fire multiple", () => {
      const r = classifyByRegex("fire alice, bob");
      expect(r).toEqual({ action: "fire", names: ["alice", "bob"] });
    });

    it("撤回 X", () => {
      const r = classifyByRegex("撤回 claude");
      expect(r).toEqual({ action: "fire", names: ["claude"] });
    });

    it("把 X 叫回來", () => {
      const r = classifyByRegex("把 gemini 叫回來");
      expect(r).toEqual({ action: "fire", names: ["gemini"] });
    });

    it("關 X", () => {
      const r = classifyByRegex("關 copilot");
      expect(r).toEqual({ action: "fire", names: ["copilot"] });
    });

    it("刪 X", () => {
      const r = classifyByRegex("刪 gpt");
      expect(r).toEqual({ action: "fire", names: ["gpt"] });
    });

    it("收回 X", () => {
      const r = classifyByRegex("收回 alice");
      expect(r).toEqual({ action: "fire", names: ["alice"] });
    });

    it("X 滾", () => {
      const r = classifyByRegex("alice 滾");
      expect(r).toEqual({ action: "fire", names: ["alice"] });
    });
  });

  // --- Group expansions ---
  describe("group expansions", () => {
    it("桃園三結義 → 劉備, 關羽, 張飛", () => {
      const r = classifyByRegex("hire 桃園三結義");
      expect(r).toEqual({ action: "hire", names: ["劉備", "關羽", "張飛"] });
    });

    it("五虎將 → 關羽, 張飛, 趙雲, 馬超, 黃忠", () => {
      const r = classifyByRegex("派出 五虎將");
      expect(r).toEqual({
        action: "hire",
        names: ["關羽", "張飛", "趙雲", "馬超", "黃忠"],
      });
    });

    it("五虎上將 (alias)", () => {
      const r = classifyByRegex("hire 五虎上將");
      expect(r).toEqual({
        action: "hire",
        names: ["關羽", "張飛", "趙雲", "馬超", "黃忠"],
      });
    });

    it("group + individual names", () => {
      const r = classifyByRegex("hire 桃園三結義, 諸葛亮");
      expect(r).toEqual({
        action: "hire",
        names: ["劉備", "關羽", "張飛", "諸葛亮"],
      });
    });

    it("fire 桃園三結義", () => {
      const r = classifyByRegex("fire 桃園三結義");
      expect(r).toEqual({ action: "fire", names: ["劉備", "關羽", "張飛"] });
    });
  });

  // --- Non-intent messages ---
  describe("non-intent messages", () => {
    it("normal question returns null", () => {
      expect(classifyByRegex("今天天氣如何？")).toBeNull();
    });

    it("empty string returns null", () => {
      expect(classifyByRegex("")).toBeNull();
    });

    it("random text returns null", () => {
      expect(classifyByRegex("help me with coding")).toBeNull();
    });

    it("partial keyword in sentence returns null", () => {
      expect(classifyByRegex("I got fired yesterday")).toBeNull();
    });
  });

  // --- Mixed Chinese/English ---
  describe("mixed patterns", () => {
    it("hire with Chinese names", () => {
      const r = classifyByRegex("hire 小明, 小華");
      expect(r).toEqual({ action: "hire", names: ["小明", "小華"] });
    });

    it("派出 with English names", () => {
      const r = classifyByRegex("派出 claude, gpt");
      expect(r).toEqual({ action: "hire", names: ["claude", "gpt"] });
    });

    it("Chinese delimiter 、", () => {
      const r = classifyByRegex("hire alice、bob、charlie");
      expect(r).toEqual({ action: "hire", names: ["alice", "bob", "charlie"] });
    });
  });
});
