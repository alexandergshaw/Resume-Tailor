import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import {
  fieldsFromText,
  extractLocation,
  tessdataConfig,
  ocrImage,
  terminateOcrWorker,
} from "./screenshotOcr.js";

afterAll(async () => {
  await terminateOcrWorker();
});

// Minimal grayscale PNG encoder — enough to hand Tesseract a valid image
// without a canvas dependency.
function crc32(buf) {
  let crc = ~0;
  for (const b of buf) {
    crc ^= b;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function whitePng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc(height * (width + 1), 255);
  for (let y = 0; y < height; y += 1) raw[y * (width + 1)] = 0; // filter byte per row
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("tessdataConfig", () => {
  it("resolves the version-pinned local language data — no CDN, no cache writes", () => {
    const cfg = tessdataConfig();
    expect(cfg.cacheMethod).toBe("none");
    expect(cfg.langPath).toBeTruthy();
    expect(cfg.langPath).toContain("4.0.0_best_int");
    expect(fs.existsSync(path.join(cfg.langPath, "eng.traineddata.gz"))).toBe(true);
    expect(cfg.gzip).toBe(true);
  });
});

describe("ocrImage (offline smoke test)", () => {
  it("boots the worker from local data and OCRs an image without the network", async () => {
    // A blank image proves the whole pipeline (wasm core + local traineddata +
    // recognize) runs; the recognized text is simply empty.
    const text = await ocrImage(whitePng(120, 40));
    expect(text).toBe("");
  }, 60000);
});

describe("fieldsFromText", () => {
  it("builds the reader contract from OCR text", () => {
    const out = fieldsFromText("Senior Software Engineer\nAcme Corp\nWe are hiring engineers to build great things.");
    expect(out.postingText).toContain("Senior Software Engineer");
    expect(typeof out.jobTitle).toBe("string");
    expect(typeof out.company).toBe("string");
    // searchQuery is the (non-empty) title + company + location joined.
    expect(out.searchQuery).toBe(
      [out.jobTitle, out.company, out.location].filter(Boolean).join(" "),
    );
  });

  it("handles empty input", () => {
    const out = fieldsFromText("");
    expect(out.postingText).toBe("");
    expect(out.searchQuery).toBe("");
  });

  it("skips nav chrome and picks the role line as the title", () => {
    const text =
      "Jobs  Home  Sign in\n☆ Save  Share\nStaff Software Engineer, Backend\nGitLab\nApply now  3 days ago\nWe are looking for a Staff Software Engineer.";
    const out = fieldsFromText(text);
    expect(out.jobTitle).toBe("Staff Software Engineer, Backend");
    expect(out.company).toBe("GitLab");
  });

  it("reads the company from a 'Company · Location · time' line under the title", () => {
    const text = "Senior Data Engineer\nNimbus Robotics · San Francisco, CA · 2 days ago\nApply\nAbout the role";
    const out = fieldsFromText(text);
    expect(out.jobTitle).toBe("Senior Data Engineer");
    expect(out.company).toBe("Nimbus Robotics");
  });

  it("prefers a role line over a company-name line the parser latched onto", () => {
    const text = "GitHub\nMenu\nSenior Product Manager - Remote (US)\nWhat you will do\nLead product strategy across teams.";
    const out = fieldsFromText(text);
    expect(out.jobTitle).toBe("Senior Product Manager - Remote (US)");
    expect(out.company).toBe("GitHub");
    expect(out.location).toBe("Remote");
  });

  it("extracts a City, ST location and includes it in the search query", () => {
    const text = "Building Inspector\nDouglas County · Omaha, NE · 3 days ago\nApply now\nInspect residential construction.";
    const out = fieldsFromText(text);
    expect(out.location).toBe("Omaha, NE");
    expect(out.searchQuery).toContain("Omaha, NE");
  });
});

describe("extractLocation", () => {
  it("finds City, ST near the title and validates the state code", () => {
    expect(extractLocation(["Engineer", "Acme · Salt Lake City, UT · today"], "Engineer")).toBe(
      "Salt Lake City, UT",
    );
    // "XX" is not a USPS state code — not a location.
    expect(extractLocation(["Widgets Ltd, XX"], "")).toBe("");
  });

  it("falls back to Remote when only a work-mode marker exists", () => {
    expect(extractLocation(["Engineer", "Fully remote position"], "Engineer")).toBe("Remote");
    expect(extractLocation(["Engineer", "No location anywhere"], "Engineer")).toBe("");
  });
});
